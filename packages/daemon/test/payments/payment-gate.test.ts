import { describe, expect, it } from "vitest";
import { decidePayment } from "../../src/payments/payment-gate.js";
import type { BlockReceipt, Job } from "../../src/spec/index.js";

function makeJob(overrides: Partial<Job> = {}): Job {
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
    startedAt: 0,
    boundaryAt: 10_000,
    ...overrides,
  };
}

const fakeReceipt: BlockReceipt = {
  v: 1,
  protocol: "bsp/0.1",
  type: "block_receipt",
  jobId: "job-1",
  blockIndex: 1,
  providerUaid: "uaid:test:provider",
  renterUaid: "uaid:test:renter",
  asset: "MOCK",
  amount: "1500",
  txId: "tx-1",
  clockStartedAt: new Date(0).toISOString(),
  boundaryAt: new Date(10_000).toISOString(),
};

describe("decidePayment", () => {
  it("rejects payment on a terminal job with job_closed", () => {
    const job = makeJob({ status: "expired", blockIndex: 3 });
    const decision = decidePayment(job, 4, 5000);
    expect(decision).toEqual({
      kind: "job_closed",
      body: { error: "job_closed", finalBlockIndex: 3, reason: "expired" },
    });
  });

  it("is idempotent for a duplicate payment on an already-settled block", () => {
    const job = makeJob({ paidThrough: 1 });
    const decision = decidePayment(job, 1, 5000, fakeReceipt);
    expect(decision).toEqual({ kind: "idempotent_replay", receipt: fakeReceipt });
  });

  it("rejects a re-settled-but-missing-receipt block as out_of_order rather than re-verifying", () => {
    const job = makeJob({ paidThrough: 1 });
    const decision = decidePayment(job, 1, 5000, undefined);
    expect(decision).toEqual({
      kind: "out_of_order",
      body: { error: "out_of_order", expectedBlockIndex: 2 },
    });
  });

  it("rejects payment for block n+2 while n+1 is unpaid, with expectedBlockIndex", () => {
    const job = makeJob({ paidThrough: 1 });
    const decision = decidePayment(job, 3, 5000);
    expect(decision).toEqual({
      kind: "out_of_order",
      body: { error: "out_of_order", expectedBlockIndex: 2 },
    });
  });

  it("accepts block 1 payment with no window gating", () => {
    const job = makeJob({ paidThrough: 0, blockIndex: 0, boundaryAt: undefined });
    const decision = decidePayment(job, 1, 0);
    expect(decision).toEqual({ kind: "verify" });
  });

  it("rejects a renewal payment attempted before the window opens", () => {
    // boundaryAt=10000, leadSeconds=4 -> window opens at 6000
    const job = makeJob({ paidThrough: 1, blockIndex: 1, boundaryAt: 10_000, leadSeconds: 4 });
    const decision = decidePayment(job, 2, 5000);
    expect(decision).toEqual({
      kind: "window_closed",
      body: { error: "window_closed", windowOpensAt: new Date(6000).toISOString() },
    });
  });

  it("accepts a renewal payment once the window is open", () => {
    const job = makeJob({ paidThrough: 1, blockIndex: 1, boundaryAt: 10_000, leadSeconds: 4 });
    const decision = decidePayment(job, 2, 6000);
    expect(decision).toEqual({ kind: "verify" });
  });

  it("accepts a renewal payment right up to (but not at) the boundary", () => {
    const job = makeJob({ paidThrough: 1, blockIndex: 1, boundaryAt: 10_000, leadSeconds: 4 });
    const decision = decidePayment(job, 2, 9_999);
    expect(decision).toEqual({ kind: "verify" });
  });

  it("rejects a renewal payment arriving after the boundary has passed", () => {
    const job = makeJob({ paidThrough: 1, blockIndex: 1, boundaryAt: 10_000, leadSeconds: 4 });
    const decision = decidePayment(job, 2, 10_000);
    expect(decision).toEqual({
      kind: "job_closed",
      body: { error: "job_closed", finalBlockIndex: 1, reason: "unpaid_boundary" },
    });
  });
});
