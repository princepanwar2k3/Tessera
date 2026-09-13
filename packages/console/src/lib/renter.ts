/**
 * Client for the renter's own local agent.
 *
 * The agent holds the key; this page never does. Everything that costs money
 * goes through here, on loopback, to a process the renter runs themselves —
 * so the marketplace cannot spend on their behalf and neither can this tab.
 */
export interface RenterIdentity {
  accountId: string;
  connected: true;
}

export interface Quote {
  machineId: string;
  blocks: number;
  pricePerBlock: string;
  asset: string;
  blockSeconds: number;
  total: string;
  uptimeSeconds: number;
}

export interface ActiveJob {
  jobId: string;
  machineId: string;
  image: string;
  blocks: number;
  budget: string;
  asset: string;
  serviceUrl?: string;
  blocksPaid: number;
  spent: string;
  stopped: boolean;
  finished: boolean;
  reason?: string;
}

const STORAGE_KEY = "tessera.renterUrl";
export const DEFAULT_RENTER_URL = "http://127.0.0.1:8091";

export function savedRenterUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_RENTER_URL;
  } catch {
    return DEFAULT_RENTER_URL;
  }
}

export function rememberRenterUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // A private window just means re-typing it next time.
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new Error(body.detail ?? body.error ?? `renter agent answered ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function connectRenter(baseUrl: string): Promise<RenterIdentity> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/whoami`, {
    signal: AbortSignal.timeout(4000),
  });
  return json<RenterIdentity>(res);
}

export async function quoteRental(
  baseUrl: string,
  machineId: string,
  blocks: number,
): Promise<Quote> {
  const url = `${baseUrl.replace(/\/$/, "")}/quote?machine=${encodeURIComponent(machineId)}&blocks=${blocks}`;
  return json<Quote>(await fetch(url));
}

export async function rentMachine(
  baseUrl: string,
  body: { machineId: string; image: string; blocks: number; exposedPort?: number },
): Promise<ActiveJob> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/rent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<ActiveJob>(res);
}

export async function stopRenewing(baseUrl: string, jobId: string): Promise<ActiveJob> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/jobs/${jobId}/stop`, { method: "POST" });
  return json<ActiveJob>(res);
}
