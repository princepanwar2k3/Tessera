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

export async function placeJob(input: {
  machineId: string;
  image: string;
  renterUaid: string;
}): Promise<{ jobId: string; endpoint: string }> {
  const res = await fetch(`${REGISTRY_URL}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status !== 402) {
    throw new Error(`Could not start the job. The registry answered ${res.status}.`);
  }
  return (await res.json()) as { jobId: string; endpoint: string };
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

  const handle = (e: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(e.data) as JobEvent);
    } catch {
      // A frame we can't read is a frame we skip; the next one re-states.
    }
  };

  for (const type of ["state", "renewal", "block", "advanced", "terminated"]) {
    source.addEventListener(type, handle as EventListener);
  }
  source.addEventListener("error", () => {
    if (source.readyState === EventSource.CLOSED) {
      onError?.("Lost the job stream. Reconnecting.");
    }
  });

  return () => source.close();
}
