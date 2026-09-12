import { beforeEach, describe, expect, it, vi } from "vitest";
import { Job } from "../src/job.js";
import { FakePayer } from "../src/payer.js";
import { hbar } from "../src/amounts.js";
import { FakeDaemon } from "./fake-daemon.js";

async function settle(ms = 80) {
  await new Promise((r) => setTimeout(r, ms));
}

function makeJob(daemon: FakeDaemon, over: Partial<ConstructorParameters<typeof Job>[0]> = {}) {
  return new Job({
    jobId: "j_test",
    endpoint: daemon.base,
    budget: hbar(1),
    pricePerBlock: daemon.pricePerBlock,
    blockSeconds: daemon.blockSeconds,
    leadSeconds: daemon.leadSeconds,
    payer: new FakePayer(),
    fetchImpl: daemon.fetch as never,
    // Off by default: most cases drive renewal through the stream, and a
    // fallback racing them would make assertions about attempts ambiguous.
    fallbackIntervalMs: 10_000,
    ...over,
  });
}

describe("Job renewal loop", () => {
  let daemon: FakeDaemon;

  beforeEach(() => {
    daemon = new FakeDaemon();
  });

  it("pays a renewal announced on the stream", async () => {
    const job = makeJob(daemon);
    const blocks: number[] = [];
    job.on("block", (b) => blocks.push(b.index));
    job.start();
    await settle(30);

    daemon.emitState();
    daemon.emitRenewal(2);
    await settle();

    expect(daemon.settled.has(2)).toBe(true);
    expect(blocks).toContain(2);
    expect(job.settledBlocks).toBe(1);
    job.stopRenewing();
  });

  it("tracks spend across settled blocks", async () => {
    const job = makeJob(daemon);
    job.start();
    await settle(30);

    daemon.emitState();
    daemon.emitRenewal(2);
    await settle();
    daemon.emitRenewal(3);
    await settle();

    expect(job.totalSpent).toBe("3000");
    job.stopRenewing();
  });

  it("stops buying once the budget cannot cover another block", async () => {
    // Budget covers exactly two blocks at 1500.
    const job = makeJob(daemon, { budget: "3000" });
    const declined: string[] = [];
    job.on("renewal", (r) => {
      if (!r.willPay && r.reason) declined.push(r.reason);
    });
    job.start();
    await settle(30);
    daemon.emitState();

    for (const n of [2, 3, 4]) {
      daemon.emitRenewal(n);
      await settle();
    }

    expect(job.settledBlocks).toBe(2);
    expect(declined).toContain("budget_exhausted");
    expect(daemon.settled.has(4)).toBe(false);
    job.stopRenewing();
  });

  it("stops buying at maxBlocks", async () => {
    const job = makeJob(daemon, { maxBlocks: 2 });
    job.start();
    await settle(30);
    daemon.emitState();

    for (const n of [2, 3, 4]) {
      daemon.emitRenewal(n);
      await settle();
    }

    expect(job.settledBlocks).toBe(2);
    job.stopRenewing();
  });

  it("the kill switch is doing nothing — stopRenewing sends no request", async () => {
    const job = makeJob(daemon);
    job.start();
    await settle(30);
    daemon.emitState();

    job.stopRenewing();
    daemon.emitRenewal(2);
    await settle();

    // No cancel message, no cleanup handshake: the job simply dies at the
    // boundary (SPEC §7, "renter disappears").
    expect(daemon.paymentAttempts).toHaveLength(0);
    expect(daemon.settled.has(2)).toBe(false);
  });

  it("reports why it declined, so a caller can show the reason", async () => {
    const job = makeJob(daemon);
    const seen: Array<{ willPay: boolean; reason?: string }> = [];
    job.on("renewal", (r) => seen.push({ willPay: r.willPay, ...(r.reason ? { reason: r.reason } : {}) }));
    job.start();
    await settle(30);
    daemon.emitState();

    job.stopRenewing();
    daemon.emitRenewal(2);
    await settle();

    expect(seen.at(-1)).toEqual({ willPay: false, reason: "stopped_by_renter" });
  });

  it("retries inside the window when the facilitator fails", async () => {
    daemon.failPayments = 2;
    const job = makeJob(daemon);
    job.start();
    await settle(30);
    daemon.emitState();

    daemon.emitRenewal(2, 8000);
    await settle(1500);

    expect(daemon.paymentAttempts.filter((n) => n === 2).length).toBeGreaterThanOrEqual(3);
    expect(daemon.settled.has(2)).toBe(true);
    job.stopRenewing();
  });

  it("waits rather than burning the window when the block resource says 425", async () => {
    daemon.windowClosedTimes = 1;
    const job = makeJob(daemon);
    job.start();
    await settle(30);
    daemon.emitState();

    daemon.emitRenewal(2, 5000);
    await settle(1200);

    expect(daemon.settled.has(2)).toBe(true);
    job.stopRenewing();
  });

  it("never pays the same block twice", async () => {
    const job = makeJob(daemon);
    job.start();
    await settle(30);
    daemon.emitState();

    daemon.emitRenewal(2);
    daemon.emitRenewal(2);
    daemon.emitRenewal(2);
    await settle(200);

    expect(daemon.paymentAttempts.filter((n) => n === 2)).toHaveLength(1);
    job.stopRenewing();
  });

  it("renews from the clock alone when no renewal event ever arrives", async () => {
    // The stream delivers state, then goes silent — no renewal event at all.
    // The timer fallback must still buy the next block.
    const job = makeJob(daemon, { fallbackIntervalMs: 20 });
    job.start();
    await settle(30);

    // Boundary 200ms away, 4s lead => the window is already open.
    daemon.emitState({ boundaryAt: new Date(Date.now() + 200).toISOString() });
    await settle(250);

    expect(daemon.settled.has(2)).toBe(true);
    job.stopRenewing();
  });

  it("resolves result() with the settlement record when the job terminates", async () => {
    const job = makeJob(daemon);
    job.start();
    await settle(30);
    daemon.emitState();
    daemon.emitRenewal(2);
    await settle();

    daemon.emitTerminated("unpaid_boundary", 2);
    const result = await job.result();

    expect(result).toMatchObject({
      jobId: "j_test",
      reason: "unpaid_boundary",
      finalBlockIndex: 2,
      blocksPaid: 1,
      spent: "1500",
    });
    expect(result.receipts.map((r) => r.blockIndex)).toEqual([2]);
  });

  it("retrieves artifacts even when the job ended expired (SPEC 5.5)", async () => {
    const job = makeJob(daemon);
    job.start();
    await settle(30);
    daemon.emitState();

    daemon.emitTerminated("unpaid_boundary", 1);
    const result = await job.result();

    expect(result.artifacts).toMatchObject({ artifacts: { stdout: "done" } });
  });

  it("counts block 1, settled before the handle existed", async () => {
    const job = makeJob(daemon);
    job.noteInitialSettlement(daemon.receipt(1));

    expect(job.settledBlocks).toBe(1);
    expect(job.totalSpent).toBe("1500");
  });

  it("reports how many more blocks the budget affords", async () => {
    const job = makeJob(daemon, { budget: "6000" });
    job.noteInitialSettlement(daemon.receipt(1));

    expect(job.blocksRemaining).toBe(3);
  });

  it("survives a caller's callback throwing", async () => {
    const job = makeJob(daemon);
    job.on("block", () => {
      throw new Error("renter callback blew up");
    });
    job.start();
    await settle(30);
    daemon.emitState();

    daemon.emitRenewal(2);
    await settle();

    // The renewal loop keeps running regardless.
    expect(daemon.settled.has(2)).toBe(true);
    job.stopRenewing();
  });
});

describe("Job renewal reporting", () => {
  let daemon: FakeDaemon;

  beforeEach(() => {
    daemon = new FakeDaemon();
  });

  it("reports a declined block once, not once per fallback tick", async () => {
    // The fallback ticks several times a second and reaches the same decision
    // every time; the renter should hear about it once.
    const job = makeJob(daemon, { maxBlocks: 1, fallbackIntervalMs: 20 });
    const declines: number[] = [];
    job.on("renewal", (r) => {
      if (!r.willPay) declines.push(r.index);
    });
    job.noteInitialSettlement(daemon.receipt(1));
    job.start();
    await settle(30);

    // Boundary 400ms out with a 4s lead: the window is open the whole time.
    daemon.emitState({ boundaryAt: new Date(Date.now() + 400).toISOString() });
    await settle(350);

    expect(declines).toEqual([2]);
    job.stopRenewing();
  });

  it("reports a paid block's renewal once even when stream and timer both fire", async () => {
    const job = makeJob(daemon, { fallbackIntervalMs: 20 });
    const renewals: number[] = [];
    job.on("renewal", (r) => renewals.push(r.index));
    job.start();
    await settle(30);

    daemon.emitState({ boundaryAt: new Date(Date.now() + 400).toISOString() });
    daemon.emitRenewal(2);
    await settle(350);

    expect(renewals.filter((i) => i === 2)).toHaveLength(1);
    job.stopRenewing();
  });
});
