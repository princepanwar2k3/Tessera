import { describe, expect, it, vi } from "vitest";
import {
  Blocky402FacilitatorClient,
  toV2Network,
  toV2Requirements,
} from "../../src/payments/blocky402-client.js";
import { createLogger } from "../../src/logging.js";
import type { PaymentRequirement } from "../../src/spec/index.js";

const logger = createLogger("test");
logger.level = "silent";

function requirement(over: Partial<PaymentRequirement["accepts"][0]> = {}): PaymentRequirement {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "hedera-testnet",
        asset: "HBAR",
        payTo: "0.0.PROVIDER",
        maxAmountRequired: "100000",
        resource: "/jobs/j_1/blocks/2",
        description: "Block 2 of 30s",
        facilitator: "https://api.testnet.blocky402.com",
        ...over,
      },
    ],
    blockMeta: {
      protocol: "bsp/0.1",
      jobId: "j_1",
      blockIndex: 2,
      blockSeconds: 30,
      leadSeconds: 10,
      windowOpensAt: "2026-09-14T10:00:20.000Z",
      boundaryAt: "2026-09-14T10:00:30.000Z",
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("v1 envelope to v2 wire", () => {
  it("renames maxAmountRequired to amount", () => {
    expect(toV2Requirements(requirement(), "0.0.7162784").amount).toBe("100000");
  });

  it("maps HBAR to asset 0.0.0", () => {
    expect(toV2Requirements(requirement(), "0.0.7162784").asset).toBe("0.0.0");
  });

  it("leaves an HTS token id alone", () => {
    expect(toV2Requirements(requirement({ asset: "0.0.429274" }), "0.0.7").asset).toBe("0.0.429274");
  });

  it("converts the network separator", () => {
    expect(toV2Network("hedera-testnet")).toBe("hedera:testnet");
    expect(toV2Network("hedera-mainnet")).toBe("hedera:mainnet");
  });

  it("carries the advertised fee payer, without which nothing settles", () => {
    expect(toV2Requirements(requirement(), "0.0.7162784").extra).toEqual({
      feePayer: "0.0.7162784",
    });
  });
});

describe("Blocky402FacilitatorClient", () => {
  const opts = (fetchImpl: unknown) => ({
    baseUrl: "https://api.testnet.blocky402.com",
    feePayer: "0.0.7162784",
    fetchImpl: fetchImpl as typeof globalThis.fetch,
  });

  const input = { jobId: "j_1", blockIndex: 2, paymentProof: { x402Version: 2 }, requirement: requirement() };

  it("verifies then settles, and returns the transaction id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ isValid: true, payer: "0.0.1234" }))
      .mockResolvedValueOnce(json({ success: true, transaction: "0.0.7162784@1757844000.1" }));

    const result = await new Blocky402FacilitatorClient(opts(fetchImpl), logger).verifyPayment(input);

    expect(result).toEqual({ ok: true, txId: "0.0.7162784@1757844000.1" });
    expect(fetchImpl.mock.calls[0]![0]).toMatch(/\/verify$/);
    expect(fetchImpl.mock.calls[1]![0]).toMatch(/\/settle$/);
  });

  it("does not settle a payment that failed verification", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ isValid: false, invalidReason: "insufficient_funds" }));

    const result = await new Blocky402FacilitatorClient(opts(fetchImpl), logger).verifyPayment(input);

    expect(result).toEqual({ ok: false, error: "insufficient_funds" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats a verified-but-unsettled payment as unpaid (I1)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ isValid: true }))
      .mockResolvedValueOnce(json({ success: false, errorReason: "submit_failed" }));

    const result = await new Blocky402FacilitatorClient(opts(fetchImpl), logger).verifyPayment(input);

    // Verified is not settled, and only settled is money.
    expect(result).toEqual({ ok: false, error: "submit_failed" });
  });

  it("reports a settle that returns success without a transaction id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ isValid: true }))
      .mockResolvedValueOnce(json({ success: true }));

    const result = await new Blocky402FacilitatorClient(opts(fetchImpl), logger).verifyPayment(input);

    expect(result.ok).toBe(false);
  });

  it("surfaces an HTTP error rather than treating it as settled", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: "bad gateway" }, 502));

    const result = await new Blocky402FacilitatorClient(opts(fetchImpl), logger).verifyPayment(input);

    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/502/);
  });

  it("fails soft on a network error, so the renter can retry in-window", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    const result = await new Blocky402FacilitatorClient(opts(fetchImpl), logger).verifyPayment(input);

    expect(result.ok).toBe(false);
  });

  it("sends the v2 envelope the facilitator expects", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ isValid: true }))
      .mockResolvedValueOnce(json({ success: true, transaction: "0.0.1@1.1" }));

    await new Blocky402FacilitatorClient(opts(fetchImpl), logger).verifyPayment(input);

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.x402Version).toBe(2);
    expect(body.paymentRequirements).toMatchObject({
      network: "hedera:testnet",
      amount: "100000",
      asset: "0.0.0",
      extra: { feePayer: "0.0.7162784" },
    });
  });
});
