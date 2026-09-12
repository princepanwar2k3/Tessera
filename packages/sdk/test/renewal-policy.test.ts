import { describe, expect, it } from "vitest";
import { blocksAffordable, decideRenewal, type BudgetState } from "../src/renewal-policy.js";
import { hbar } from "../src/amounts.js";

function state(overrides: Partial<BudgetState> = {}): BudgetState {
  return {
    spent: "0",
    budget: hbar(1),
    blocksPaid: 0,
    pricePerBlock: "1500",
    ...overrides,
  };
}

describe("decideRenewal", () => {
  it("pays when budget and block count both allow", () => {
    expect(decideRenewal(state())).toEqual({ pay: true });
  });

  it("declines once the block cap is reached", () => {
    expect(decideRenewal(state({ maxBlocks: 5, blocksPaid: 5 }))).toEqual({
      pay: false,
      reason: "max_blocks_reached",
    });
  });

  it("pays the last block up to the cap", () => {
    expect(decideRenewal(state({ maxBlocks: 5, blocksPaid: 4 }))).toEqual({ pay: true });
  });

  it("declines when the next block would exceed the budget, not after", () => {
    // Budget 3000, spent 3000: the next block would make it 4500.
    expect(decideRenewal(state({ budget: "3000", spent: "3000" }))).toEqual({
      pay: false,
      reason: "budget_exhausted",
    });
  });

  it("pays a block that lands exactly on the budget", () => {
    expect(decideRenewal(state({ budget: "3000", spent: "1500" }))).toEqual({ pay: true });
  });

  it("declines a block that would exceed the budget by one unit", () => {
    expect(decideRenewal(state({ budget: "2999", spent: "1500" }))).toEqual({
      pay: false,
      reason: "budget_exhausted",
    });
  });

  it("declines when the renter has stopped renewing, whatever the budget says", () => {
    expect(decideRenewal(state({ budget: hbar(100) }), true)).toEqual({
      pay: false,
      reason: "stopped_by_renter",
    });
  });

  it("handles amounts past Number.MAX_SAFE_INTEGER without losing precision", () => {
    const huge = "9007199254740993"; // 2^53 + 1
    expect(decideRenewal(state({ budget: huge, spent: "9007199254740992", pricePerBlock: "1" }))).toEqual({
      pay: true,
    });
    expect(decideRenewal(state({ budget: huge, spent: "9007199254740993", pricePerBlock: "1" }))).toEqual({
      pay: false,
      reason: "budget_exhausted",
    });
  });
});

describe("blocksAffordable", () => {
  it("counts what the remaining budget buys", () => {
    expect(blocksAffordable(state({ budget: "10000", spent: "1000", pricePerBlock: "1500" }))).toBe(6);
  });

  it("is capped by maxBlocks when that binds first", () => {
    expect(
      blocksAffordable(state({ budget: hbar(10), spent: "0", maxBlocks: 3, blocksPaid: 1 })),
    ).toBe(2);
  });

  it("is zero once the budget is spent", () => {
    expect(blocksAffordable(state({ budget: "1000", spent: "1000" }))).toBe(0);
  });

  it("never goes negative when the cap is already met", () => {
    expect(blocksAffordable(state({ maxBlocks: 2, blocksPaid: 5 }))).toBe(0);
  });
});
