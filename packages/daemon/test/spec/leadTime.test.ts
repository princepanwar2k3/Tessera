import { describe, expect, it } from "vitest";
import { validateLeadTime } from "../../src/spec/index.js";

describe("validateLeadTime", () => {
  it("rejects lead < 4 regardless of block size", () => {
    expect(validateLeadTime(30, 3).ok).toBe(false);
    expect(validateLeadTime(5, 1).ok).toBe(false);
  });

  it("accepts the reference default (30s block, 10s lead)", () => {
    expect(validateLeadTime(30, 10)).toEqual({ ok: true });
  });

  it("accepts the fast-demo config (10s block, 4s lead)", () => {
    expect(validateLeadTime(10, 4)).toEqual({ ok: true });
  });

  it("rejects lead below ceil(0.3 * block) even when >= 4", () => {
    // ceil(0.3 * 20) = 6, so lead=5 must fail despite being >= 4
    expect(validateLeadTime(20, 5).ok).toBe(false);
    expect(validateLeadTime(20, 6)).toEqual({ ok: true });
  });

  it("rejects lead >= block_seconds", () => {
    expect(validateLeadTime(10, 10).ok).toBe(false);
    expect(validateLeadTime(10, 11).ok).toBe(false);
  });

  it("rejects a 10s block with a 1s window (the PLAN.md misconfiguration example)", () => {
    const result = validateLeadTime(10, 1);
    expect(result.ok).toBe(false);
  });

  it("accepts a large block with proportionally large lead", () => {
    expect(validateLeadTime(3600, 1080)).toEqual({ ok: true }); // ceil(0.3*3600)=1080
    expect(validateLeadTime(3600, 1079).ok).toBe(false);
  });
});

describe("validateLeadTime delegates to the protocol's §4.1 validator", () => {
  it("agrees with @bsp/protocol on every verdict, so the rules cannot drift apart", async () => {
    const { validateBlockTiming } = await import("@bsp/protocol");
    for (let blockSeconds = 4; blockSeconds <= 40; blockSeconds++) {
      for (let leadSeconds = 0; leadSeconds <= blockSeconds + 1; leadSeconds++) {
        const mine = validateLeadTime(blockSeconds, leadSeconds);
        const canonical = validateBlockTiming(blockSeconds, leadSeconds);
        expect(mine.ok).toBe(canonical.length === 0);
      }
    }
  });

  it("carries the protocol's own message as the rejection reason", async () => {
    const { validateBlockTiming } = await import("@bsp/protocol");
    const result = validateLeadTime(30, 8);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a rejection");
    expect(result.reason).toBe(validateBlockTiming(30, 8)[0]!.message);
  });
});
