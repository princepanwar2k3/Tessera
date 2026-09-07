import { describe, expect, it } from "vitest";
import { validateReceipt } from "@bsp/protocol";
import { MockFacilitatorClient } from "../../src/payments/facilitator-client.js";

describe("MockFacilitatorClient", () => {
  it("mints a txId the protocol's receipt validator accepts", async () => {
    const facilitator = new MockFacilitatorClient();
    const result = await facilitator.verifyPayment({
      jobId: "job-1",
      blockIndex: 1,
      paymentProof: { mock: true },
      requirement: {} as never,
    });
    expect(result.ok).toBe(true);

    // A mock whose txId the validator rejects makes the whole receipt path
    // untestable offline: every publish would be refused.
    const issues = validateReceipt({
      v: 1,
      protocol: "bsp/0.1",
      type: "block_receipt",
      jobId: "job-1",
      blockIndex: 1,
      asset: "MOCK",
      amount: "1500",
      txId: (result as { txId: string }).txId,
      clockStartedAt: "2026-09-07T10:00:00.000Z",
      boundaryAt: "2026-09-07T10:00:30.000Z",
    });
    expect(issues).toEqual([]);
  });
});
