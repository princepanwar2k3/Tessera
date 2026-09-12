import { beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "../../src/jobs/scheduler.js";
import { JobRegistry } from "../../src/jobs/job-registry.js";
import { FakeClock } from "../../src/jobs/fake-clock.js";
import { createLogger } from "../../src/logging.js";
import type { Job } from "../../src/spec/index.js";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: overrides.id ?? "job-1",
    renterUaid: "uaid:test:renter",
    image: "busybox:latest",
    blockSeconds: 10,
    leadSeconds: 4,
    pricePerBlock: "1500",
    asset: "MOCK",
    blockIndex: 1,
    paidThrough: 1,
    status: "running",
    createdAt: 0,
    startedAt: 0,
    boundaryAt: 10_000,
    ...overrides,
  };
}

const silentLogger = createLogger("test");
silentLogger.level = "silent";

describe("Scheduler (watchdog)", () => {
  let registry: JobRegistry;
  let clock: FakeClock;
  let onAdvance: ReturnType<typeof vi.fn>;
  let onTerminate: ReturnType<typeof vi.fn>;
  let scheduler: Scheduler;

  beforeEach(() => {
    registry = new JobRegistry();
    clock = new FakeClock(0);
    onAdvance = vi.fn();
    onTerminate = vi.fn().mockResolvedValue(undefined);
    scheduler = new Scheduler(registry, clock, onAdvance, onTerminate, silentLogger, 1000);
  });

  it("terminates a job at the boundary when unpaid", () => {
    const job = makeJob({ paidThrough: 1, boundaryAt: 10_000 });
    registry.add(job);
    scheduler.start();

    clock.tick(9_000); // 9s — before boundary
    expect(onTerminate).not.toHaveBeenCalled();

    clock.tick(1_000); // 10s — at boundary, unpaid
    expect(onTerminate).toHaveBeenCalledTimes(1);
    expect(onTerminate).toHaveBeenCalledWith(job, "unpaid_boundary");
  });

  it("advances a job at the boundary when the next block is already paid", () => {
    const job = makeJob({ paidThrough: 2, blockIndex: 1, boundaryAt: 10_000 });
    registry.add(job);
    scheduler.start();

    clock.tick(10_000);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith(job, { nextBlockIndex: 2, nextBoundaryAt: 20_000 });
    expect(onTerminate).not.toHaveBeenCalled();
  });

  it("does not re-terminate a job once it has left the active set", () => {
    const job = makeJob({ paidThrough: 1, boundaryAt: 10_000 });
    registry.add(job);
    scheduler.start();

    clock.tick(10_000);
    expect(onTerminate).toHaveBeenCalledTimes(1);

    // Simulate what terminateJob does synchronously: flip status off the active list.
    job.status = "expired";

    clock.tick(5_000); // further ticks must not re-fire for this job
    expect(onTerminate).toHaveBeenCalledTimes(1);
  });

  it("evaluates multiple concurrent jobs independently in one tick", () => {
    const paidJob = makeJob({ id: "paid", paidThrough: 2, blockIndex: 1, boundaryAt: 10_000 });
    const unpaidJob = makeJob({ id: "unpaid", paidThrough: 1, blockIndex: 1, boundaryAt: 10_000 });
    registry.add(paidJob);
    registry.add(unpaidJob);
    scheduler.start();

    clock.tick(10_000);

    expect(onAdvance).toHaveBeenCalledWith(paidJob, { nextBlockIndex: 2, nextBoundaryAt: 20_000 });
    expect(onTerminate).toHaveBeenCalledWith(unpaidJob, "unpaid_boundary");
  });

  it("ignores jobs that are not active (awaiting_payment, closed, etc.)", () => {
    const job = makeJob({ status: "awaiting_payment", boundaryAt: 10_000 });
    registry.add(job);
    scheduler.start();

    clock.tick(10_000);
    expect(onAdvance).not.toHaveBeenCalled();
    expect(onTerminate).not.toHaveBeenCalled();
  });

  it("stops ticking once stop() is called", () => {
    const job = makeJob({ paidThrough: 1, boundaryAt: 10_000 });
    registry.add(job);
    scheduler.start();
    scheduler.stop();

    clock.tick(20_000);
    expect(onTerminate).not.toHaveBeenCalled();
  });
});

describe("Scheduler — renewal window (SPEC 5.3)", () => {
  let registry: JobRegistry;
  let clock: FakeClock;
  let onWindowOpen: ReturnType<typeof vi.fn>;
  let scheduler: Scheduler;

  beforeEach(() => {
    registry = new JobRegistry();
    clock = new FakeClock(0);
    onWindowOpen = vi.fn();
    scheduler = new Scheduler(
      registry,
      clock,
      vi.fn(),
      vi.fn().mockResolvedValue(undefined),
      silentLogger,
      1000,
      onWindowOpen,
    );
  });

  it("opens the window at boundary minus leadSeconds, not before", () => {
    // 10s block, 4s lead -> window opens at 6s.
    registry.add(makeJob({ boundaryAt: 10_000, leadSeconds: 4, paidThrough: 1 }));
    scheduler.start();

    clock.tick(5_000);
    expect(onWindowOpen).not.toHaveBeenCalled();

    clock.tick(1_000); // 6s
    expect(onWindowOpen).toHaveBeenCalledTimes(1);
  });

  it("announces the NEXT block, not the one running", () => {
    const job = makeJob({ blockIndex: 3, paidThrough: 3, boundaryAt: 10_000, leadSeconds: 4 });
    registry.add(job);
    scheduler.start();

    clock.tick(6_000);

    expect(onWindowOpen).toHaveBeenCalledWith(job, 4);
  });

  it("fires once per block even though the watchdog ticks every second", () => {
    registry.add(makeJob({ boundaryAt: 10_000, leadSeconds: 4, paidThrough: 1 }));
    scheduler.start();

    clock.tick(9_000); // ticks at 6s, 7s, 8s, 9s all inside the window

    expect(onWindowOpen).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the renter has already prepaid the next block", () => {
    registry.add(makeJob({ blockIndex: 1, paidThrough: 2, boundaryAt: 10_000, leadSeconds: 4 }));
    scheduler.start();

    clock.tick(9_000);

    expect(onWindowOpen).not.toHaveBeenCalled();
  });

  it("announces again for the following block after an advance", () => {
    const job = makeJob({ blockIndex: 1, paidThrough: 1, boundaryAt: 10_000, leadSeconds: 4 });
    registry.add(job);
    scheduler.start();

    clock.tick(6_000); // window for block 2
    expect(onWindowOpen).toHaveBeenCalledTimes(1);

    // Renter pays, the boundary advances the job into block 2.
    job.paidThrough = 2;
    job.blockIndex = 2;
    job.boundaryAt = 20_000;

    clock.tick(10_000); // reaches 16s — window for block 3
    expect(onWindowOpen).toHaveBeenCalledTimes(2);
    expect(onWindowOpen).toHaveBeenLastCalledWith(job, 3);
  });

  it("does not announce for a job that is still starting (no clock yet)", () => {
    registry.add(makeJob({ status: "starting", boundaryAt: undefined, startedAt: undefined }));
    scheduler.start();

    clock.tick(20_000);

    expect(onWindowOpen).not.toHaveBeenCalled();
  });
});
