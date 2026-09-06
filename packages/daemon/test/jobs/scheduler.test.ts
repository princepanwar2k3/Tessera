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
