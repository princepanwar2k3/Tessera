import type { Broker } from "./broker.js";

type FetchLike = typeof globalThis.fetch;

export interface MirrorHandle {
  close: () => void;
}

/**
 * Re-broadcasts one job's daemon event stream to console clients.
 *
 * This exists so the console can watch a job without needing CORS on every
 * provider daemon and without discovering daemon URLs itself. It is strictly
 * a convenience: the SDK connects to the daemon directly, and if this process
 * dies the job is unaffected. Nothing here can influence settlement.
 */
export function proxyJobEvents(
  broker: Broker,
  jobId: string,
  write: (chunk: string) => void,
  opts: { fetchImpl?: FetchLike; lastEventId?: string | undefined } = {},
): { ok: false; status: number; error: string } | { ok: true; handle: MirrorHandle } {
  const placement = broker.getPlacement(jobId);
  if (!placement) return { ok: false, status: 404, error: "job_not_placed" };

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  let closed = false;

  void (async () => {
    const url = `${placement.endpoint.replace(/\/$/, "")}/jobs/${jobId}/events`;
    const headers: Record<string, string> = {};
    if (opts.lastEventId) headers["last-event-id"] = opts.lastEventId;

    try {
      const res = await fetchImpl(url, { headers, signal: controller.signal });
      if (!res.ok || !res.body) {
        write(`event: error\ndata: ${JSON.stringify({ error: "daemon_stream_unavailable", status: res.status })}\n\n`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        // Pass frames through verbatim: the console and the SDK must see the
        // same event shapes, and re-encoding is a chance to get them wrong.
        write(decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if (!closed) {
        write(
          `event: error\ndata: ${JSON.stringify({
            error: "daemon_stream_failed",
            detail: err instanceof Error ? err.message : String(err),
          })}\n\n`,
        );
      }
    }
  })();

  return {
    ok: true,
    handle: {
      close: () => {
        closed = true;
        controller.abort();
      },
    },
  };
}
