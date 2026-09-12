import { describe, expect, it, vi } from "vitest";
import { JobEventBus, snapshotOf } from "../../src/events/job-events.js";
import type { Job } from "../../src/spec/index.js";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
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
    startedAt: 1_000,
    boundaryAt: 11_000,
    ...overrides,
  };
}

const advanced = (jobId: string, blockIndex: number) =>
  ({ type: "advanced", jobId, blockIndex, boundaryAt: "2026-09-14T10:00:30.000Z" }) as const;

describe("JobEventBus", () => {
  it("delivers events to subscribers of that job only", () => {
    const bus = new JobEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe("job-1", a);
    bus.subscribe("job-2", b);

    bus.publish(advanced("job-1", 2));

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("delivers every job's events to subscribeAll — the control-plane mirror", () => {
    const bus = new JobEventBus();
    const all = vi.fn();
    bus.subscribeAll(all);

    bus.publish(advanced("job-1", 2));
    bus.publish(advanced("job-2", 3));

    expect(all).toHaveBeenCalledTimes(2);
  });

  it("stamps a monotonically increasing seq", () => {
    const bus = new JobEventBus();
    const first = bus.publish(advanced("job-1", 2));
    const second = bus.publish(advanced("job-2", 2));
    const third = bus.publish(advanced("job-1", 3));

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(third.seq).toBe(3);
  });

  it("replays only what a reconnecting client missed", () => {
    const bus = new JobEventBus();
    bus.publish(advanced("job-1", 2));
    const seen = bus.publish(advanced("job-1", 3));
    bus.publish(advanced("job-1", 4));

    const missed = bus.replay("job-1", seen.seq);

    expect(missed.map((e) => e.seq)).toEqual([seen.seq + 1]);
  });

  it("replays everything retained when no cursor is given", () => {
    const bus = new JobEventBus();
    bus.publish(advanced("job-1", 2));
    bus.publish(advanced("job-1", 3));

    expect(bus.replay("job-1")).toHaveLength(2);
  });

  it("bounds the replay buffer rather than growing without limit", () => {
    const bus = new JobEventBus(3);
    for (let i = 0; i < 10; i++) bus.publish(advanced("job-1", i));

    const buffered = bus.replay("job-1");
    expect(buffered).toHaveLength(3);
    expect(buffered.map((e) => e.seq)).toEqual([8, 9, 10]);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = new JobEventBus();
    const listener = vi.fn();
    const off = bus.subscribe("job-1", listener);

    bus.publish(advanced("job-1", 2));
    off();
    bus.publish(advanced("job-1", 3));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing subscriber from the publisher and other subscribers", () => {
    const bus = new JobEventBus();
    const healthy = vi.fn();
    bus.subscribe("job-1", () => {
      throw new Error("subscriber blew up");
    });
    bus.subscribe("job-1", healthy);

    // The publisher here is the settlement path. It must not see this throw.
    expect(() => bus.publish(advanced("job-1", 2))).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("forgets a job's buffer on request", () => {
    const bus = new JobEventBus();
    bus.publish(advanced("job-1", 2));
    bus.forget("job-1");

    expect(bus.replay("job-1")).toEqual([]);
  });
});

describe("snapshotOf", () => {
  it("renders clock timestamps as RFC3339 for the wire", () => {
    const snap = snapshotOf(job({ startedAt: 1_757_844_000_000, boundaryAt: 1_757_844_030_000 }));

    expect(snap.clockStartedAt).toBe("2025-09-14T10:00:00.000Z");
    expect(snap.boundaryAt).toBe("2025-09-14T10:00:30.000Z");
  });

  it("omits the clock start before the container is ready (SPEC 5.2)", () => {
    const snap = snapshotOf(job({ status: "awaiting_payment", startedAt: undefined }));

    expect(snap.clockStartedAt).toBeUndefined();
    expect(snap.status).toBe("awaiting_payment");
  });
});
