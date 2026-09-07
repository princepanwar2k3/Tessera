import { describe, expect, it } from "vitest";
import { buildBlockReceipt } from "../../src/receipts/receipt-builder.js";
import type { Job } from "../../src/spec/index.js";

const BLOCK_MS = 10_000;
const READY_AT = 25_000;

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    renterUaid: "uaid:test:renter",
    image: "busybox:latest",
    blockSeconds: 10,
    leadSeconds: 4,
    pricePerBlock: "1500",
    asset: "MOCK",
    blockIndex: 2,
    paidThrough: 3,
    status: "running",
    createdAt: 0,
    startedAt: READY_AT,
    // The job is serving block 2, so its own boundary is the end of block 2.
    boundaryAt: READY_AT + 2 * BLOCK_MS,
    ...overrides,
  };
}

describe("buildBlockReceipt: boundaryAt is the end of the block paid for", () => {
  it("stamps block 3's own boundary, not the boundary the payment crossed", () => {
    // Paying block 3 happens while block 2 is being served, so job.boundaryAt
    // is still block 2's end. The receipt must describe block 3.
    const receipt = buildBlockReceipt(job(), 3, "0.0.1@1.1", "uaid:test:provider");
    expect(Date.parse(receipt.boundaryAt)).toBe(READY_AT + 3 * BLOCK_MS);
  });

  it("gives block 1 a full block measured from service_ready (SPEC §5.2)", () => {
    const receipt = buildBlockReceipt(
      job({ blockIndex: 1, paidThrough: 1, boundaryAt: READY_AT + BLOCK_MS }),
      1,
      "0.0.1@1.1",
      "uaid:test:provider",
    );
    expect(Date.parse(receipt.clockStartedAt)).toBe(READY_AT);
    expect(Date.parse(receipt.boundaryAt) - Date.parse(receipt.clockStartedAt)).toBe(BLOCK_MS);
  });

  it("gives consecutive blocks distinct boundaries one block apart (SPEC §8)", () => {
    const boundaries = [1, 2, 3, 4, 5, 6].map((n) =>
      Date.parse(buildBlockReceipt(job(), n, "0.0.1@1.1", "uaid:test:provider").boundaryAt),
    );
    expect(new Set(boundaries).size).toBe(6);
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i]! - boundaries[i - 1]!).toBe(BLOCK_MS);
    }
  });
});
