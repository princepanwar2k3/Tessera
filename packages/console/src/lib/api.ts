import type { JobEvent, MachineListing } from "./types.js";

/** Control plane base URL. Set at build time; falls back to a local dev node. */
export const REGISTRY_URL: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.["VITE_REGISTRY_URL"] ??
  "http://127.0.0.1:8090";

export async function fetchMachines(signal?: AbortSignal): Promise<MachineListing[]> {
  const res = await fetch(`${REGISTRY_URL}/machines`, signal ? { signal } : {});
  if (!res.ok) throw new Error(`The registry answered ${res.status}.`);
  return ((await res.json()) as { machines: MachineListing[] }).machines;
}

export interface Placement {
  jobId: string;
  machineId: string;
  providerId: string;
  endpoint: string;
  renterUaid: string;
  placedAt: string;
}

/**
 * Jobs the registry has placed. The console watches jobs; it never starts or
 * pays for one.
 *
 * Renting means signing a payment with the renter's key, and a browser page
 * is the wrong place to hold one — that is the same reason the control plane
 * does not hold one either. Renting happens from the SDK or the agent, and
 * everything that follows is visible here.
 */
export async function fetchJobs(signal?: AbortSignal): Promise<Placement[]> {
  const res = await fetch(`${REGISTRY_URL}/jobs`, signal ? { signal } : {});
  if (!res.ok) throw new Error(`The registry answered ${res.status}.`);
  return ((await res.json()) as { jobs: Placement[] }).jobs;
}

export interface JobArtifacts {
  jobId: string;
  status: string;
  artifacts: { stdout: string; stderr: string; artifactDir?: string };
}

/** Container output for a finished job. 409 until the job has stopped. */
export async function fetchArtifacts(jobId: string): Promise<JobArtifacts | undefined> {
  const res = await fetch(`${REGISTRY_URL}/jobs/${jobId}/artifacts`);
  if (!res.ok) return undefined;
  return (await res.json()) as JobArtifacts;
}

/**
 * Subscribe to a job's event stream through the control plane's mirror, so the
 * console needs no CORS arrangement with every provider daemon.
 *
 * EventSource reconnects and resends Last-Event-ID on its own, and the mirror
 * replays from there — so a dropped connection costs nothing.
 */
export function subscribeToJob(
  jobId: string,
  onEvent: (event: JobEvent) => void,
  onError?: (message: string) => void,
): () => void {
  const source = new EventSource(`${REGISTRY_URL}/jobs/${jobId}/events`);
  let closed = false;

  const close = () => {
    closed = true;
    source.close();
  };

  const handle = (e: MessageEvent<string>) => {
    if (closed) return;
    let event: JobEvent;
    try {
      event = JSON.parse(e.data) as JobEvent;
    } catch {
      return; // A frame we can't read is a frame we skip; the next one re-states.
    }
    onEvent(event);

    // A terminated job emits nothing further, and the daemon closes its end.
    // EventSource would then reconnect, the mirror would replay the whole
    // buffer, and the daemon would close again — an endless loop that floods
    // the page. Stop listening at the terminal event instead.
    if (event.type === "terminated") close();
  };

  for (const type of ["state", "renewal", "block", "advanced", "terminated"]) {
    source.addEventListener(type, handle as EventListener);
  }
  source.addEventListener("error", () => {
    if (!closed && source.readyState === EventSource.CLOSED) {
      onError?.("Lost the job stream. Reconnecting.");
    }
  });

  return close;
}
