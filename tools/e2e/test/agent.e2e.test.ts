import { afterEach, describe, expect, it } from "vitest";
import { startStack, type Stack } from "../src/fixture.js";
import { RentingAgent } from "@bsp/agent";

let stack: Stack | undefined;

afterEach(async () => {
  await stack?.close();
  stack = undefined;
});

describe("the agent rents unattended and reports cost per unit", () => {
  it("compares two listings on price and block size, then runs on its choice", async () => {
    stack = await startStack({
      nodes: [
        // Cheaper rate (200/5s = 40/s) but coarse relative to the workload.
        { providerId: "coarse", blockSeconds: 10, leadSeconds: 4, pricePerBlock: "400" },
        // Dearer rate (300/5s = 60/s) yet finer blocks.
        { providerId: "fine", blockSeconds: 5, leadSeconds: 4, pricePerBlock: "150" },
      ],
    });

    const lines: string[] = [];
    const agent = new RentingAgent({
      marketplace: stack.marketplace,
      log: (l) => lines.push(l),
      fallbackIntervalMs: 100,
    });

    const report = await agent.run({
      image: "busybox:latest",
      seconds: 15,
      budget: "10000",
      unitsOfWork: 3,
      unitLabel: "frame",
    });

    // coarse: ceil(15/10) = 2 blocks x 400 = 800
    // fine:   ceil(15/5)  = 3 blocks x 150 = 450  <- cheaper overall
    expect(report.selection.chosen?.machineId).toBe("fine");
    expect(report.estimatedCost).toBe("450");
    expect(report.blocksEstimated).toBe(3);

    // It actually ran, unattended, and paid for what it used.
    expect(report.blocksPaid).toBe(3);
    expect(report.actualCost).toBe("450");
    expect(report.result.receipts.map((r) => r.blockIndex)).toEqual([1, 2, 3]);

    // Cost per unit of work: 450 over 3 frames.
    expect(report.costPerUnit).toBeCloseTo(150, 5);
    expect(report.unitLabel).toBe("frame");

    // The decision is visible, not implicit.
    const trace = lines.join("\n");
    expect(trace).toContain("coarse");
    expect(trace).toContain("fine");
    expect(trace).toMatch(/Chose fine/);
    expect(trace).toMatch(/Cost per frame/);
  }, 80_000);

  it("refuses to rent when nothing fits the budget", async () => {
    stack = await startStack({
      nodes: [{ providerId: "node-a", blockSeconds: 5, leadSeconds: 4, pricePerBlock: "100000" }],
    });

    const agent = new RentingAgent({ marketplace: stack.marketplace, log: () => {} });

    await expect(
      agent.run({ image: "busybox:latest", seconds: 30, budget: "100" }),
    ).rejects.toThrow(/no machine satisfies/i);
  });
});
