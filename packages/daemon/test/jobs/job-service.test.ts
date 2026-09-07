import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobService } from "../../src/jobs/job-service.js";
import { JobRegistry } from "../../src/jobs/job-registry.js";
import { FakeClock } from "../../src/jobs/fake-clock.js";
import { Scheduler } from "../../src/jobs/scheduler.js";
import { FakeDockerRunner } from "../../src/docker/fake-docker-runner.js";
import { MockFacilitatorClient } from "../../src/payments/facilitator-client.js";
import { LocalFileReceiptSink } from "../../src/receipts/receipt-sink.js";
import { createLogger } from "../../src/logging.js";

const logger = createLogger("test");
logger.level = "silent";

describe("JobService + Scheduler integration (fakes only, no Docker/network)", () => {
  let dataDir: string;
  let registry: JobRegistry;
  let clock: FakeClock;
  let docker: FakeDockerRunner;
  let facilitator: MockFacilitatorClient;
  let receiptSink: LocalFileReceiptSink;
  let service: JobService;
  let scheduler: Scheduler;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "tessera-daemon-test-"));
    registry = new JobRegistry();
    clock = new FakeClock(0);
    docker = new FakeDockerRunner(clock);
    facilitator = new MockFacilitatorClient();
    receiptSink = new LocalFileReceiptSink(dataDir);
    service = new JobService(
      registry,
      docker,
      facilitator,
      receiptSink,
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
    );
    scheduler = new Scheduler(
      registry,
      clock,
      (job, next) => service.handleAdvance(job, next),
      (job, reason) => service.handleTerminate(job, reason),
      logger,
      1000,
    );
  });

  afterEach(async () => {
    scheduler.stop();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("drives a full job: create -> pay -> start -> renew -> continue -> stop paying -> terminate", async () => {
    // 1. create job (10s blocks, 4s lead, matching the fast-demo config)
    const created = service.createJob({
      renterUaid: "uaid:test:renter",
      image: "busybox:latest",
      blockSeconds: 10,
      leadSeconds: 4,
      pricePerBlock: "1500",
      asset: "MOCK",
    });
    expect(created.status).toBe(402);
    const jobId = (created.body as { blockMeta: { jobId: string } }).blockMeta.jobId;

    // 2. pay block 1 -> container starts, clock starts at "readyAt" (== clock.now() in the fake)
    const pay1 = await service.submitPayment(jobId, 1, { mock: true });
    expect(pay1.status).toBe(200);

    const job = service.getJob(jobId)!;
    expect(job.status).toBe("running");
    expect(job.blockIndex).toBe(1);
    expect(job.boundaryAt).toBe(10_000); // startedAt(0) + blockSeconds(10)*1000

    scheduler.start();

    // 3. advance into the renewal window (opens at boundary - lead = 6000) and pay block 2
    clock.tick(6_000);
    const pay2 = await service.submitPayment(jobId, 2, { mock: true });
    expect(pay2.status).toBe(200);

    // 4. cross the boundary -> should advance seamlessly, not terminate
    clock.tick(4_000); // now = 10_000
    expect(job.status).toBe("running");
    expect(job.blockIndex).toBe(2);
    expect(job.boundaryAt).toBe(20_000);

    // 5. stop paying: let the next boundary (20_000) pass unpaid
    clock.tick(10_000); // now = 20_000
    await scheduler.waitForIdle();
    expect(job.status).toBe("expired");
    expect(docker.isRunning(job.containerId!)).toBe(false);
    expect(docker.signalsReceived(job.containerId!)).toContain("SIGTERM");

    // 6. exactly one terminal receipt was recorded, reason unpaid_boundary
    const { readFile } = await import("node:fs/promises");
    const lines = (await readFile(join(dataDir, "receipts", `${jobId}.jsonl`), "utf-8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const terminal = lines.filter((r) => r.type === "terminated");
    expect(terminal).toHaveLength(1);
    expect(terminal[0].reason).toBe("unpaid_boundary");
  });

  it("rejects a renewal payment attempted before the window opens (425)", async () => {
    const created = service.createJob({
      renterUaid: "uaid:test:renter",
      image: "busybox:latest",
      blockSeconds: 10,
      leadSeconds: 4,
      pricePerBlock: "1500",
      asset: "MOCK",
    });
    const jobId = (created.body as { blockMeta: { jobId: string } }).blockMeta.jobId;
    await service.submitPayment(jobId, 1, { mock: true });

    clock.tick(3_000); // window opens at 6000, not yet
    const early = await service.submitPayment(jobId, 2, { mock: true });
    expect(early.status).toBe(425);
  });

  it("rejects out-of-order payment for block n+2 while n+1 is unpaid (409)", async () => {
    const created = service.createJob({
      renterUaid: "uaid:test:renter",
      image: "busybox:latest",
      blockSeconds: 10,
      leadSeconds: 4,
      pricePerBlock: "1500",
      asset: "MOCK",
    });
    const jobId = (created.body as { blockMeta: { jobId: string } }).blockMeta.jobId;
    await service.submitPayment(jobId, 1, { mock: true });

    const outOfOrder = await service.submitPayment(jobId, 3, { mock: true });
    expect(outOfOrder.status).toBe(409);
    expect((outOfOrder.body as { expectedBlockIndex: number }).expectedBlockIndex).toBe(2);
  });

  it("is idempotent for a duplicate payment on an already-settled block (200, no double charge)", async () => {
    const created = service.createJob({
      renterUaid: "uaid:test:renter",
      image: "busybox:latest",
      blockSeconds: 10,
      leadSeconds: 4,
      pricePerBlock: "1500",
      asset: "MOCK",
    });
    const jobId = (created.body as { blockMeta: { jobId: string } }).blockMeta.jobId;
    const first = await service.submitPayment(jobId, 1, { mock: true });
    const duplicate = await service.submitPayment(jobId, 1, { mock: true });

    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual(first.body);
  });

  it("rejects a listing whose lead time violates the floor (400)", () => {
    const created = service.createJob({
      renterUaid: "uaid:test:renter",
      image: "busybox:latest",
      blockSeconds: 10,
      leadSeconds: 1,
      pricePerBlock: "1500",
      asset: "MOCK",
    });
    expect(created.status).toBe(400);
  });
});
