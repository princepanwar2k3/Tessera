import { describe, expect, it } from "vitest";
import { quote, selectMachine } from "../src/selection.js";
import type { MachineRow } from "@bsp/sdk";
import { BENCH_NAME } from "@bsp/protocol";

function machine(over: {
  machineId: string;
  blockSeconds: number;
  pricePerBlock: string;
  cpuCores?: number;
  memoryMB?: number;
  live?: boolean;
}): MachineRow {
  return {
    machineId: over.machineId,
    providerId: `provider-${over.machineId}`,
    endpoint: `http://${over.machineId}.test:8080`,
    specs: { cpuCores: over.cpuCores ?? 4, memoryMB: over.memoryMB ?? 8192, arch: "x64" },
    params: {
      blockSeconds: over.blockSeconds,
      leadSeconds: Math.max(4, Math.ceil(0.3 * over.blockSeconds)),
      pricePerBlock: over.pricePerBlock,
      asset: "HBAR",
    },
    benchmark: { name: BENCH_NAME, score: 1000, ranAt: "2026-09-10T00:00:00.000Z", selfReported: true },
    live: over.live ?? true,
    lastSeenAt: "2026-09-12T00:00:00.000Z",
  } as MachineRow;
}

describe("quote", () => {
  it("bills the final block whole (SPEC 5.6)", () => {
    // 90s of work on 60s blocks needs 2 blocks, forfeiting 30s.
    const q = quote(machine({ machineId: "a", blockSeconds: 60, pricePerBlock: "1000" }), 90);

    expect(q.blocksNeeded).toBe(2);
    expect(q.totalCost).toBe("2000");
    expect(q.wastedSeconds).toBe(30);
  });

  it("forfeits nothing when the work divides evenly", () => {
    const q = quote(machine({ machineId: "a", blockSeconds: 15, pricePerBlock: "300" }), 90);

    expect(q.blocksNeeded).toBe(6);
    expect(q.wastedSeconds).toBe(0);
  });

  it("always buys at least one block", () => {
    const q = quote(machine({ machineId: "a", blockSeconds: 30, pricePerBlock: "1000" }), 1);
    expect(q.blocksNeeded).toBe(1);
  });
});

describe("selectMachine", () => {
  /**
   * PLAN.md's example, and the reason block size is a market variable:
   * a cheaper node with 60s blocks costs more for a 90s job than a dearer
   * node with 15s blocks.
   */
  it("prefers finer blocks when coarse ones forfeit more than they save", () => {
    const cheapButCoarse = machine({ machineId: "coarse", blockSeconds: 60, pricePerBlock: "1000" });
    const dearerButFine = machine({ machineId: "fine", blockSeconds: 15, pricePerBlock: "300" });

    const result = selectMachine([cheapButCoarse, dearerButFine], {
      seconds: 90,
      budget: "10000",
    });

    // coarse: 2 blocks x 1000 = 2000. fine: 6 blocks x 300 = 1800.
    expect(result.chosen?.machineId).toBe("fine");
    expect(result.chosen?.totalCost).toBe("1800");
    expect(result.reasoning.join("\n")).toMatch(/cheaper rate/);
  });

  it("prefers the coarse node when the work fills its blocks", () => {
    const coarse = machine({ machineId: "coarse", blockSeconds: 60, pricePerBlock: "1000" });
    const fine = machine({ machineId: "fine", blockSeconds: 15, pricePerBlock: "300" });

    // 120s divides evenly both ways: coarse 2x1000 = 2000, fine 8x300 = 2400.
    const result = selectMachine([coarse, fine], { seconds: 120, budget: "10000" });

    expect(result.chosen?.machineId).toBe("coarse");
  });

  it("breaks a cost tie toward finer blocks, for smaller exposure under I2", () => {
    const coarse = machine({ machineId: "coarse", blockSeconds: 60, pricePerBlock: "600" });
    const fine = machine({ machineId: "fine", blockSeconds: 30, pricePerBlock: "300" });

    // 60s: coarse 1x600 = 600, fine 2x300 = 600.
    const result = selectMachine([coarse, fine], { seconds: 60, budget: "10000" });

    expect(result.chosen?.machineId).toBe("fine");
  });

  it("rejects a machine that is offline", () => {
    const result = selectMachine(
      [machine({ machineId: "down", blockSeconds: 30, pricePerBlock: "100", live: false })],
      { seconds: 60, budget: "10000" },
    );

    expect(result.chosen).toBeUndefined();
    expect(result.rejected[0]).toMatchObject({ machineId: "down", reason: "offline" });
  });

  it("rejects a machine that cannot meet the spec", () => {
    const result = selectMachine(
      [machine({ machineId: "small", blockSeconds: 30, pricePerBlock: "100", cpuCores: 2 })],
      { seconds: 60, budget: "10000", minCpuCores: 8 },
    );

    expect(result.chosen).toBeUndefined();
    expect(result.rejected[0]!.reason).toMatch(/2 cores < 8/);
  });

  it("rejects a machine whose total exceeds the budget", () => {
    const result = selectMachine(
      [machine({ machineId: "dear", blockSeconds: 30, pricePerBlock: "5000" })],
      { seconds: 60, budget: "1000" },
    );

    expect(result.chosen).toBeUndefined();
    expect(result.rejected[0]!.reason).toMatch(/over budget/);
  });

  it("says so when nothing fits, rather than choosing badly", () => {
    const result = selectMachine([], { seconds: 60, budget: "1000" });

    expect(result.chosen).toBeUndefined();
    expect(result.reasoning.at(-1)).toMatch(/No machine satisfies/);
  });

  it("prints a decision trace naming every candidate", () => {
    const result = selectMachine(
      [
        machine({ machineId: "coarse", blockSeconds: 60, pricePerBlock: "1000" }),
        machine({ machineId: "fine", blockSeconds: 15, pricePerBlock: "300" }),
        machine({ machineId: "down", blockSeconds: 30, pricePerBlock: "1", live: false }),
      ],
      { seconds: 90, budget: "10000" },
    );

    const trace = result.reasoning.join("\n");
    // A visible decision beats an invisible one.
    expect(trace).toContain("coarse");
    expect(trace).toContain("fine");
    expect(trace).toContain("down");
    expect(trace).toMatch(/Chose fine/);
  });

  it("reports cost per second of useful work", () => {
    const result = selectMachine(
      [machine({ machineId: "fine", blockSeconds: 15, pricePerBlock: "300" })],
      { seconds: 90, budget: "10000" },
    );

    expect(result.chosen?.costPerSecond).toBeCloseTo(20, 5);
  });
});
