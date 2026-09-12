import { describe, expect, it, vi } from "vitest";
import { JobEventStream } from "../src/stream.js";
import type { SequencedJobEvent } from "../src/events.js";

/** Builds a Response whose body emits the given SSE frames then ends. */
function sseResponse(frames: string[], { hang = false } = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      if (!hang) controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const frame = (seq: number, payload: object) =>
  `id: ${seq}\nevent: block\ndata: ${JSON.stringify({ ...payload, seq })}\n\n`;

async function settle(ms = 60) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("JobEventStream", () => {
  it("parses framed events and hands them to the consumer", async () => {
    const seen: SequencedJobEvent[] = [];
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([frame(1, { type: "block", jobId: "j", blockIndex: 1 })], { hang: true }),
    );

    const stream = new JobEventStream("http://d/events", (e) => seen.push(e), {
      fetchImpl: fetchImpl as never,
    });
    stream.start();
    await settle();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "block", blockIndex: 1, seq: 1 });
    stream.close();
  });

  it("ignores keepalive comments", async () => {
    const seen: SequencedJobEvent[] = [];
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([": keepalive\n\n", frame(1, { type: "block", jobId: "j", blockIndex: 1 })], {
        hang: true,
      }),
    );

    const stream = new JobEventStream("http://d/events", (e) => seen.push(e), {
      fetchImpl: fetchImpl as never,
    });
    stream.start();
    await settle();

    expect(seen).toHaveLength(1);
    stream.close();
  });

  it("reconnects after the stream ends and resumes from the last event id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([frame(7, { type: "block", jobId: "j", blockIndex: 1 })]))
      .mockResolvedValue(sseResponse([], { hang: true }));

    const stream = new JobEventStream("http://d/events", () => {}, {
      fetchImpl: fetchImpl as never,
      reconnectDelaysMs: [5],
    });
    stream.start();
    await settle(120);

    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
    const retryHeaders = (fetchImpl.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders["last-event-id"]).toBe("7");
    stream.close();
  });

  it("keeps retrying when the daemon is unreachable, and reports the error", async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const stream = new JobEventStream("http://d/events", () => {}, {
      fetchImpl: fetchImpl as never,
      reconnectDelaysMs: [5],
      onError,
    });
    stream.start();
    await settle(120);

    // A dead stream must never become terminal: a paid job outlives it.
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    expect(onError).toHaveBeenCalled();
    stream.close();
  });

  it("does not let the seq-0 state frame rewind the cursor after a reconnect", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([frame(9, { type: "block", jobId: "j", blockIndex: 1 })]))
      .mockResolvedValue(
        sseResponse([`event: state\ndata: ${JSON.stringify({ type: "state", jobId: "j", seq: 0 })}\n\n`], {
          hang: true,
        }),
      );

    const stream = new JobEventStream("http://d/events", () => {}, {
      fetchImpl: fetchImpl as never,
      reconnectDelaysMs: [5],
    });
    stream.start();
    await settle(120);

    expect(stream.cursor).toBe(9);
    stream.close();
  });

  it("stops fetching once closed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([], { hang: true }));
    const stream = new JobEventStream("http://d/events", () => {}, {
      fetchImpl: fetchImpl as never,
      reconnectDelaysMs: [5],
    });
    stream.start();
    await settle(30);
    stream.close();
    const callsAtClose = fetchImpl.mock.calls.length;
    await settle(60);

    expect(fetchImpl.mock.calls.length).toBe(callsAtClose);
  });

  it("survives an unparseable frame", async () => {
    const seen: SequencedJobEvent[] = [];
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse(
        ["event: block\ndata: {not json\n\n", frame(2, { type: "block", jobId: "j", blockIndex: 2 })],
        { hang: true },
      ),
    );

    const stream = new JobEventStream("http://d/events", (e) => seen.push(e), {
      fetchImpl: fetchImpl as never,
    });
    stream.start();
    await settle();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ blockIndex: 2 });
    stream.close();
  });
});
