import type { SequencedJobEvent } from "./events.js";

type FetchLike = typeof globalThis.fetch;

export interface StreamOptions {
  fetchImpl?: FetchLike;
  /** Backoff between reconnect attempts, ms. Grows to the last value. */
  reconnectDelaysMs?: number[];
  onError?: (err: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

const DEFAULT_RECONNECT_MS = [250, 500, 1000, 2000, 5000];

/**
 * SSE client for `GET /jobs/:id/events`, with automatic reconnection that
 * resumes from the last seen event id.
 *
 * This stream is a *hint, never a dependency*. Everything it
 * delivers is also reachable by polling the 402 on the block resource, and
 * `Job` keeps a timer fallback running regardless of stream health. A dropped
 * stream must never be able to kill a paid job, so nothing here throws
 * outward: failures reconnect, and the caller is told so it can log.
 */
export class JobEventStream {
  private controller?: AbortController;
  private closed = false;
  private lastEventId = 0;
  private attempt = 0;

  constructor(
    private readonly url: string,
    private readonly onEvent: (event: SequencedJobEvent) => void,
    private readonly opts: StreamOptions = {},
  ) {}

  /** Position the stream resumes from — survives reconnects. */
  get cursor(): number {
    return this.lastEventId;
  }

  start(): void {
    if (this.closed) return;
    void this.run();
  }

  close(): void {
    this.closed = true;
    this.controller?.abort();
    this.opts.onClose?.();
  }

  private async run(): Promise<void> {
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch;

    while (!this.closed) {
      this.controller = new AbortController();
      try {
        const headers: Record<string, string> = { accept: "text/event-stream" };
        if (this.lastEventId > 0) headers["last-event-id"] = String(this.lastEventId);

        const res = await fetchImpl(this.url, { headers, signal: this.controller.signal });
        if (!res.ok || !res.body) throw new Error(`stream responded ${res.status}`);

        this.attempt = 0;
        this.opts.onOpen?.();
        await this.consume(res.body);
      } catch (err) {
        if (this.closed) return;
        this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      }

      if (this.closed) return;
      await this.sleep(this.nextDelay());
    }
  }

  private async consume(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!this.closed) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        this.handleFrame(frame);
      }
    }
  }

  private handleFrame(frame: string): void {
    if (frame.startsWith(":")) return; // keepalive comment

    let data: string | undefined;
    for (const line of frame.split("\n")) {
      if (line.startsWith("data: ")) data = line.slice(6);
      else if (line.startsWith("id: ")) {
        const id = Number(line.slice(4));
        if (Number.isInteger(id) && id > this.lastEventId) this.lastEventId = id;
      }
    }
    if (!data) return;

    try {
      const event = JSON.parse(data) as SequencedJobEvent;
      // The `state` frame is sent with seq 0 on every connection; don't let it
      // rewind a cursor built up across reconnects.
      if (typeof event.seq === "number" && event.seq > this.lastEventId) {
        this.lastEventId = event.seq;
      }
      this.onEvent(event);
    } catch {
      // A frame we can't parse is a frame we ignore; the timer fallback covers us.
    }
  }

  private nextDelay(): number {
    const delays = this.opts.reconnectDelaysMs ?? DEFAULT_RECONNECT_MS;
    const delay = delays[Math.min(this.attempt, delays.length - 1)] ?? 1000;
    this.attempt++;
    return delay;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }
}
