import { describe, expect, it } from "vitest";
import { evaluateBoundary, isWindowOpen, windowOpensAt } from "../../src/spec/index.js";

const baseJob = {
  blockIndex: 3,
  paidThrough: 3,
  boundaryAt: 100_000,
  blockSeconds: 30,
};

describe("evaluateBoundary", () => {
  it("is a no-op before the boundary", () => {
    expect(evaluateBoundary(baseJob, 99_999)).toEqual({ action: "none" });
  });

  it("is a no-op when boundaryAt is undefined (job not yet started)", () => {
    expect(evaluateBoundary({ ...baseJob, boundaryAt: undefined }, 1)).toEqual({ action: "none" });
  });

  it("terminates exactly at the boundary when unpaid", () => {
    expect(evaluateBoundary(baseJob, 100_000)).toEqual({
      action: "terminate",
      reason: "unpaid_boundary",
    });
  });

  it("terminates when evaluated late (jitter past the boundary) and still unpaid", () => {
    expect(evaluateBoundary(baseJob, 100_950)).toEqual({
      action: "terminate",
      reason: "unpaid_boundary",
    });
  });

  it("advances when the next block is already paid for", () => {
    const paid = { ...baseJob, paidThrough: 4 };
    expect(evaluateBoundary(paid, 100_000)).toEqual({
      action: "advance",
      nextBlockIndex: 4,
      nextBoundaryAt: 130_000,
    });
  });

  it("advances correctly even when evaluated late", () => {
    const paid = { ...baseJob, paidThrough: 4 };
    expect(evaluateBoundary(paid, 100_950)).toEqual({
      action: "advance",
      nextBlockIndex: 4,
      // nextBoundaryAt is boundaryAt + blockSeconds, never "now" based —
      // guards against clock drift accumulating from late evaluation.
      nextBoundaryAt: 130_000,
    });
  });

  it("does not advance on paidThrough === blockIndex (must be strictly greater)", () => {
    expect(evaluateBoundary({ ...baseJob, paidThrough: 3 }, 100_000).action).toBe("terminate");
  });

  it("advances past multiple pre-paid blocks one boundary at a time", () => {
    const farAhead = { ...baseJob, paidThrough: 10 };
    const result = evaluateBoundary(farAhead, 100_000);
    expect(result).toEqual({
      action: "advance",
      nextBlockIndex: 4,
      nextBoundaryAt: 130_000,
    });
  });
});

describe("windowOpensAt / isWindowOpen", () => {
  it("computes window open as boundaryAt - leadSeconds", () => {
    expect(windowOpensAt(100_000, 10)).toBe(90_000);
  });

  it("is open at exactly windowOpensAt", () => {
    expect(isWindowOpen(100_000, 10, 90_000)).toBe(true);
  });

  it("is closed just before windowOpensAt", () => {
    expect(isWindowOpen(100_000, 10, 89_999)).toBe(false);
  });

  it("is closed at and after the boundary", () => {
    expect(isWindowOpen(100_000, 10, 100_000)).toBe(false);
    expect(isWindowOpen(100_000, 10, 100_001)).toBe(false);
  });
});
