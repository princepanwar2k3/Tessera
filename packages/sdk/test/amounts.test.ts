import { describe, expect, it } from "vitest";
import { addAmounts, compareAmounts, formatHbar, hbar, multiplyAmount } from "../src/amounts.js";

describe("hbar", () => {
  it("converts whole HBAR to tinybars", () => {
    expect(hbar(2)).toBe("200000000");
  });

  it("converts fractional HBAR without float error", () => {
    // 0.1 * 1e8 in floating point is 10000000.000000002.
    expect(hbar(0.1)).toBe("10000000");
    expect(hbar(1.5)).toBe("150000000");
  });

  it("handles zero", () => {
    expect(hbar(0)).toBe("0");
  });

  it("rejects a negative amount", () => {
    expect(() => hbar(-1)).toThrow();
  });

  it("rejects a non-finite amount", () => {
    expect(() => hbar(Number.NaN)).toThrow();
  });
});

describe("formatHbar", () => {
  it("renders whole HBAR without a fraction", () => {
    expect(formatHbar("200000000")).toBe("2");
  });

  it("trims trailing zeros from the fraction", () => {
    expect(formatHbar("150000000")).toBe("1.5");
  });

  it("round-trips with hbar()", () => {
    expect(formatHbar(hbar(3.25))).toBe("3.25");
  });
});

describe("amount arithmetic", () => {
  it("adds beyond Number.MAX_SAFE_INTEGER exactly", () => {
    expect(addAmounts("9007199254740993", "1")).toBe("9007199254740994");
  });

  it("multiplies by a block count", () => {
    expect(multiplyAmount("1500", 20)).toBe("30000");
  });

  it("rejects a fractional multiplier", () => {
    expect(() => multiplyAmount("1500", 1.5)).toThrow();
  });

  it("compares without precision loss", () => {
    expect(compareAmounts("9007199254740993", "9007199254740992")).toBe(1);
    expect(compareAmounts("10", "10")).toBe(0);
    expect(compareAmounts("9", "10")).toBe(-1);
  });
});
