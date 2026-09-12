import { describe, expect, it } from "vitest";
import {
  buildStrip,
  emptyMeterState,
  reduceMeter,
  terminationCopy,
  type MeterState,
} from "../src/lib/meter-state.js";
import type { JobEvent } from "../src/lib/types.js";

const T0 = Date.parse("2026-09-14T10:00:00.000Z");
const BLOCK_MS = 10_000;

const stateEvent = (over: Partial<MeterState["snapshot"]> = {}): JobEvent => ({
  type: "state",
  jobId: "j",
  job: {
    jobId: "j",
    status: "running",
    blockIndex: 1,
    paidThrough: 1,
    blockSeconds: 10,
    leadSeconds: 4,
    pricePerBlock: "1500",
    asset: "HBAR",
    clockStartedAt: new Date(T0).toISOString(),
    boundaryAt: new Date(T0 + BLOCK_MS).toISOString(),
    ...over,
  },
});

const blockEvent = (blockIndex: number): JobEvent => ({
  type: "block",
  jobId: "j",
  blockIndex,
  receipt: {
    blockIndex,
    amount: "1500",
    asset: "HBAR",
    txId: `0.0.1234@1757844000.00000000${blockIndex}`,
  },
});

const renewalEvent = (blockIndex: number, boundaryMs: number): JobEvent => ({
  type: "renewal",
  jobId: "j",
  blockIndex,
  windowOpensAt: new Date(boundaryMs - 4000).toISOString(),
  boundaryAt: new Date(boundaryMs).toISOString(),
  msLeft: 4000,
});

function fold(events: JobEvent[]): MeterState {
  return events.reduce(reduceMeter, emptyMeterState);
}

describe("reduceMeter", () => {
  it("records a settled block once, however many times it is announced", () => {
    const state = fold([stateEvent(), blockEvent(1), blockEvent(1)]);
    expect(state.receipts).toHaveLength(1);
  });

  it("stamps a receipt line with its transaction id", () => {
    const state = fold([stateEvent(), blockEvent(2)]);
    expect(state.ticker[0]).toMatchObject({
      kind: "block",
      blockIndex: 2,
      amount: "1500",
    });
    expect(state.ticker[0]!.txId).toMatch(/^0\.0\.\d+@/);
  });

  it("keeps the newest receipt at the top of the ticker", () => {
    const state = fold([stateEvent(), blockEvent(1), blockEvent(2)]);
    expect(state.ticker.map((l) => l.blockIndex)).toEqual([2, 1]);
  });

  it("opens the window on a renewal event", () => {
    const state = fold([stateEvent(), renewalEvent(2, T0 + BLOCK_MS)]);
    expect(state.windowFor).toBe(2);
  });

  it("closes the window the instant the block it was for settles", () => {
    const state = fold([stateEvent(), renewalEvent(2, T0 + BLOCK_MS), blockEvent(2)]);
    // Amber must stop the moment it stops being true.
    expect(state.windowFor).toBeUndefined();
  });

  it("closes the window when the boundary advances past it", () => {
    const state = fold([
      stateEvent(),
      renewalEvent(2, T0 + BLOCK_MS),
      { type: "advanced", jobId: "j", blockIndex: 2, boundaryAt: new Date(T0 + 2 * BLOCK_MS).toISOString() },
    ]);
    expect(state.windowFor).toBeUndefined();
  });

  it("freezes and marks the job expired on termination", () => {
    const state = fold([
      stateEvent(),
      blockEvent(1),
      renewalEvent(2, T0 + BLOCK_MS),
      { type: "terminated", jobId: "j", reason: "unpaid_boundary", finalBlockIndex: 1, receipt: { reason: "unpaid_boundary", finalBlockIndex: 1 } },
    ]);

    expect(state.terminated).toEqual({ reason: "unpaid_boundary", finalBlockIndex: 1 });
    expect(state.snapshot?.status).toBe("expired");
    // No amber on a dead job.
    expect(state.windowFor).toBeUndefined();
  });
});

describe("terminationCopy", () => {
  it("says what happened and where it stopped", () => {
    expect(terminationCopy("unpaid_boundary", 5)).toBe(
      "Renewal window closed. Job ended at block 5.",
    );
  });

  it("distinguishes a service that finished from one that expired", () => {
    expect(terminationCopy("completed", 3)).toMatch(/finished/);
  });
});

describe("buildStrip", () => {
  it("draws nothing before the job reports state", () => {
    expect(buildStrip(emptyMeterState, T0)).toEqual([]);
  });

  it("fills the current block in proportion to elapsed time", () => {
    const state = fold([stateEvent(), blockEvent(1)]);

    expect(buildStrip(state, T0)[0]!.fill).toBeCloseTo(0, 2);
    expect(buildStrip(state, T0 + BLOCK_MS / 2)[0]!.fill).toBeCloseTo(0.5, 2);
    expect(buildStrip(state, T0 + BLOCK_MS)[0]!.fill).toBeCloseTo(1, 2);
  });

  it("never fills past full, even if the boundary evaluation is late", () => {
    const state = fold([stateEvent(), blockEvent(1)]);
    expect(buildStrip(state, T0 + BLOCK_MS * 3)[0]!.fill).toBe(1);
  });

  it("shows settled blocks behind the one being served", () => {
    const state = fold([
      stateEvent(),
      blockEvent(1),
      blockEvent(2),
      { type: "advanced", jobId: "j", blockIndex: 2, boundaryAt: new Date(T0 + 2 * BLOCK_MS).toISOString() },
    ]);

    const strip = buildStrip(state, T0 + BLOCK_MS + 1000);
    expect(strip.map((c) => c.tone)).toEqual(["settled", "current"]);
  });

  it("marks the served block amber while the next one is unbought", () => {
    const state = fold([stateEvent(), blockEvent(1), renewalEvent(2, T0 + BLOCK_MS)]);

    const strip = buildStrip(state, T0 + 6000);
    expect(strip[0]!.windowOpen).toBe(true);
  });

  it("shows no amber when there is no open window", () => {
    const state = fold([stateEvent(), blockEvent(1)]);
    expect(buildStrip(state, T0 + 6000).some((c) => c.windowOpen)).toBe(false);
  });

  it("ends the strip on an expired block and draws nothing beyond it", () => {
    const state = fold([
      stateEvent(),
      blockEvent(1),
      blockEvent(2),
      { type: "advanced", jobId: "j", blockIndex: 2, boundaryAt: new Date(T0 + 2 * BLOCK_MS).toISOString() },
      { type: "terminated", jobId: "j", reason: "unpaid_boundary", finalBlockIndex: 2, receipt: { reason: "unpaid_boundary", finalBlockIndex: 2 } },
    ]);

    const strip = buildStrip(state, T0 + 3 * BLOCK_MS);
    expect(strip).toHaveLength(2);
    expect(strip.map((c) => c.tone)).toEqual(["settled", "expired"]);
    expect(strip.some((c) => c.windowOpen)).toBe(false);
  });
});
