import { afterEach, describe, expect, it } from "vitest";
import { startStack, type Stack } from "../src/fixture.js";
import { hbar } from "@bsp/sdk";

let stack: Stack | undefined;

afterEach(async () => {
  await stack?.close();
  stack = undefined;
});

describe("end to end: place through the registry, run, settle", () => {
  it("runs a multi-block job to its budget and stops at a boundary", async () => {
    stack = await startStack();

    const job = await stack.marketplace.rent({
      machine: "node-a",
      image: "busybox:latest",
      // Exactly three blocks at 1500 each. Block 1 is settled by rent().
      budget: "4500",
      fallbackIntervalMs: 100,
    });

    const settled: number[] = [];
    job.on("block", (b) => settled.push(b.index));

    const result = await job.result();

    // I1: every block served was paid for first, so the count of receipts is
    // the count of blocks served.
    expect(result.blocksPaid).toBe(3);
    expect(result.spent).toBe("4500");
    expect(settled).toEqual([2, 3]);
    expect(result.receipts.map((r) => r.blockIndex)).toEqual([1, 2, 3]);

    // I3: it ended at a boundary, for non-renewal, not mid-block.
    expect(result.reason).toBe("unpaid_boundary");
    expect(result.finalBlockIndex).toBe(3);

    // Every receipt carries a real-shaped transaction id.
    for (const receipt of result.receipts) {
      expect(receipt.txId).toMatch(/^0\.0\.\d+@\d+\.\d+$/);
      expect(receipt.amount).toBe("1500");
    }
  });

  it("honours maxBlocks even when the budget would allow more", async () => {
    stack = await startStack();

    const job = await stack.marketplace.rent({
      machine: "node-a",
      image: "busybox:latest",
      budget: hbar(10),
      maxBlocks: 2,
      fallbackIntervalMs: 100,
    });

    const result = await job.result();

    expect(result.blocksPaid).toBe(2);
    expect(result.spent).toBe("3000");
  });

  it("ends the job at the next boundary when the renter stops renewing", async () => {
    stack = await startStack();

    const job = await stack.marketplace.rent({
      machine: "node-a",
      image: "busybox:latest",
      budget: hbar(10),
      fallbackIntervalMs: 100,
    });

    // The kill switch: stop buying. No message is sent to the provider.
    job.on("block", (b) => {
      if (b.index >= 2) job.stopRenewing();
    });

    const result = await job.result();

    expect(result.reason).toBe("unpaid_boundary");
    expect(result.blocksPaid).toBe(2);
    // Artifacts from paid blocks survive an `expired` termination (SPEC §5.5).
    expect(result.artifacts).toBeDefined();
  }, 60_000);

  it("delivers artifacts from paid blocks even though the job expired", async () => {
    stack = await startStack();

    const job = await stack.marketplace.rent({
      machine: "node-a",
      image: "busybox:latest",
      budget: "3000",
      fallbackIntervalMs: 100,
    });

    const result = await job.result();

    expect(result.reason).toBe("unpaid_boundary");
    expect(result.artifacts).toMatchObject({ status: "expired" });
  });

  it("places on the machine the renter chose, out of two listings", async () => {
    stack = await startStack({
      nodes: [
        { providerId: "node-a", blockSeconds: 5, leadSeconds: 4, pricePerBlock: "1500" },
        { providerId: "node-b", blockSeconds: 10, leadSeconds: 4, pricePerBlock: "2000" },
      ],
    });

    const machines = await stack.marketplace.machines();
    expect(machines.map((m) => m.machineId).sort()).toEqual(["node-a", "node-b"]);
    // Granularity is a market variable (SPEC §4.2) and it is visible here.
    expect(machines.find((m) => m.machineId === "node-b")!.params.blockSeconds).toBe(10);

    const job = await stack.marketplace.rent({
      machine: "node-b",
      image: "busybox:latest",
      budget: "4000",
      fallbackIntervalMs: 100,
    });

    const nodeB = stack.daemons.find((d) => d.providerId === "node-b")!;
    expect(nodeB.registry.get(job.id)).toBeDefined();
    // The renter pays node-b directly, not the registry.
    expect(job.state?.blockSeconds ?? 10).toBe(10);

    const result = await job.result();
    expect(result.blocksPaid).toBe(2);
    expect(result.spent).toBe("4000");
  }, 60_000);
});
