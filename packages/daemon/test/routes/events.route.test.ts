import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/server.js";
import { JobService } from "../../src/jobs/job-service.js";
import { JobRegistry } from "../../src/jobs/job-registry.js";
import { JobEventBus, type SequencedJobEvent } from "../../src/events/job-events.js";
import { FakeClock } from "../../src/jobs/fake-clock.js";
import { Scheduler } from "../../src/jobs/scheduler.js";
import { FakeDockerRunner } from "../../src/docker/fake-docker-runner.js";
import { MockFacilitatorClient } from "../../src/payments/facilitator-client.js";
import { LocalFileReceiptSink } from "../../src/receipts/receipt-sink.js";
import { createLogger } from "../../src/logging.js";
import { runBenchmark } from "../../src/controlplane/attestation.js";
import { collectHardwareSpecs } from "../../src/controlplane/specs.js";

const logger = createLogger("test");
logger.level = "silent";

/**
 * Reads an SSE response body, resolving once `want` events have arrived.
 * Real HTTP rather than `app.inject`, because the thing under test is a
 * long-lived stream and inject buffers to completion.
 */
async function collectEvents(
  url: string,
  want: number,
  init: RequestInit = {},
): Promise<{ events: SequencedJobEvent[]; done: Promise<void>; stop: () => void }> {
  const controller = new AbortController();
  const res = await fetch(url, { ...init, signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");

  const events: SequencedJobEvent[] = [];
  let resolve!: () => void;
  const reached = new Promise<void>((r) => (resolve = r));

  const done = (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        let split: number;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const data = frame
            .split("\n")
            .find((l) => l.startsWith("data: "))
            ?.slice(6);
          if (data) {
            events.push(JSON.parse(data) as SequencedJobEvent);
            if (events.length >= want) resolve();
          }
        }
      }
    } catch {
      // aborted by stop() — expected
    }
    resolve();
  })();

  await reached;
  return { events, done, stop: () => controller.abort() };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for condition");
}

describe("GET /jobs/:jobId/events (SSE)", () => {
  let dataDir: string;
  let app: FastifyInstance;
  let base: string;
  let clock: FakeClock;
  let service: JobService;
  let scheduler: Scheduler;
  let events: JobEventBus;
  let registry: JobRegistry;
  const openStreams: Array<() => void> = [];

  beforeEach(async () => {
    openStreams.length = 0;
    dataDir = await mkdtemp(join(tmpdir(), "tessera-sse-test-"));
    registry = new JobRegistry();
    clock = new FakeClock(0);
    events = new JobEventBus();
    service = new JobService(
      registry,
      new FakeDockerRunner(clock),
      new MockFacilitatorClient(),
      new LocalFileReceiptSink(dataDir),
      clock,
      {
        dataDir,
        graceMs: 5000,
        providerUaid: "uaid:test:provider",
        network: "hedera-testnet",
        payTo: "0.0.PROVIDER",
        facilitatorUrl: "https://facilitator.test",
      },
      logger,
      undefined,
      events,
    );
    scheduler = new Scheduler(
      registry,
      clock,
      (job, next) => service.handleAdvance(job, next),
      (job, reason) => service.handleTerminate(job, reason),
      logger,
      1000,
      (job, blockIndex) => service.announceRenewal(job, blockIndex),
    );
    scheduler.start();

    app = buildServer(
      service,
      logger,
      { providerId: "node-test", specs: collectHardwareSpecs(), attestation: runBenchmark() },
      events,
    );
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    // Abort every stream this test opened, including ones a failed assertion
    // skipped past — otherwise app.close() waits on a live SSE connection.
    for (const stop of openStreams) stop();
    scheduler.stop();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  /** Create a running job: 402, then settle block 1 which starts the container. */
  async function startJob() {
    const created = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        renterUaid: "uaid:test:renter",
        image: "busybox:latest",
        blockSeconds: 10,
        leadSeconds: 4,
        pricePerBlock: "1500",
        asset: "MOCK",
      }),
    });
    expect(created.status).toBe(402);
    const requirement = (await created.json()) as { blockMeta: { jobId: string } };
    const jobId = requirement.blockMeta.jobId;

    const paid = await fetch(`${base}/jobs/${jobId}/blocks/1/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof: "mock" }),
    });
    expect(paid.status).toBe(200);
    return jobId;
  }

  it("404s for a job that does not exist", async () => {
    const res = await fetch(`${base}/jobs/nope/events`);
    expect(res.status).toBe(404);
  });

  /** collectEvents + automatic teardown registration. */
  async function openStream(url: string, want: number, init: RequestInit = {}) {
    const stream = await collectEvents(url, want, init);
    openStreams.push(stream.stop);
    return stream;
  }

  it("opens with a state snapshot so a late subscriber needs no other call", async () => {
    const jobId = await startJob();
    const stream = await openStream(`${base}/jobs/${jobId}/events`, 1);

    expect(stream.events[0]).toMatchObject({
      type: "state",
      jobId,
      job: { status: "running", blockIndex: 1, paidThrough: 1, blockSeconds: 10 },
    });

    stream.stop();
    await stream.done;
  });

  it("pushes a block event when a renewal settles", async () => {
    const jobId = await startJob();
    const stream = await openStream(`${base}/jobs/${jobId}/events`, 1);

    // Block 2 is only payable once its window opens — paying at t=0 is a 425
    // by SPEC §7, so open the window before settling.
    clock.tick(6_000);

    await fetch(`${base}/jobs/${jobId}/blocks/2/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof: "mock" }),
    });

    // Block 1's settlement is in the replay buffer from startJob(), so match
    // on the renewal we actually just paid.
    await waitFor(() => stream.events.some((e) => e.type === "block" && e.blockIndex === 2));
    const block = stream.events.find((e) => e.type === "block" && e.blockIndex === 2)!;
    expect(block).toMatchObject({ type: "block", blockIndex: 2 });
    expect((block as { receipt: { txId: string } }).receipt.txId).toMatch(/^0\.0\.\d+@\d+\.\d+$/);

    stream.stop();
    await stream.done;
  });

  it("pushes the renewal challenge at window open, carrying the full 402 body", async () => {
    const jobId = await startJob();
    const stream = await openStream(`${base}/jobs/${jobId}/events`, 1);

    clock.tick(6_000); // 10s block, 4s lead -> window opens at 6s

    await waitFor(() => stream.events.some((e) => e.type === "renewal"));
    const renewal = stream.events.find((e) => e.type === "renewal")! as Extract<
      SequencedJobEvent,
      { type: "renewal" }
    >;
    expect(renewal.blockIndex).toBe(2);
    expect(renewal.requirement.x402Version).toBe(1);
    expect(renewal.requirement.accepts[0]!.maxAmountRequired).toBe("1500");
    expect(renewal.requirement.blockMeta.blockIndex).toBe(2);

    stream.stop();
    await stream.done;
  });

  it("pushes a terminated event when the boundary passes unpaid", async () => {
    const jobId = await startJob();
    const stream = await openStream(`${base}/jobs/${jobId}/events`, 1);

    clock.tick(11_000); // past the boundary with block 2 unpaid
    await scheduler.waitForIdle();

    await waitFor(() => stream.events.some((e) => e.type === "terminated"));
    expect(stream.events.find((e) => e.type === "terminated")).toMatchObject({
      type: "terminated",
      reason: "unpaid_boundary",
      finalBlockIndex: 1,
    });

    stream.stop();
    await stream.done;
  });

  it("replays only missed events to a client reconnecting with Last-Event-ID", async () => {
    const jobId = await startJob();

    // Produce two events with nobody listening: the renewal challenge, then
    // the settlement that answers it.
    clock.tick(6_000);
    await fetch(`${base}/jobs/${jobId}/blocks/2/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof: "mock" }),
    });

    const buffered = events.replay(jobId);
    const renewalSeq = buffered.find((e) => e.type === "renewal")!.seq;
    expect(buffered.some((e) => e.type === "block")).toBe(true);

    // Reconnect as if the stream had dropped just after the renewal arrived:
    // the client must get the settlement it missed, and not the renewal again.
    const stream = await openStream(`${base}/jobs/${jobId}/events`, 2, {
      headers: { "last-event-id": String(renewalSeq) },
    });

    expect(stream.events.filter((e) => e.type === "renewal")).toHaveLength(0);
    const blocks = stream.events.filter((e) => e.type === "block");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ blockIndex: 2 });

    stream.stop();
    await stream.done;
  });
});
