import type { PaymentRequirement } from "../spec/index.js";

export interface VerifyPaymentInput {
  jobId: string;
  blockIndex: number;
  paymentProof: unknown;
  requirement: PaymentRequirement;
}

/** Not a real account; identifies mock settlements at a glance. */
const MOCK_PAYER_ACCOUNT = "0.0.999999";

export type VerifyPaymentResult = { ok: true; txId: string } | { ok: false; error: string };

export interface FacilitatorClient {
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
}

export interface MockFacilitatorClientOptions {
  /** Force the next verifyPayment call to fail, then reset. */
  failNext?: boolean;
  /** Simulate settlement latency. */
  latencyMs?: number;
}

/**
 * Default FacilitatorClient: accepts any payment proof as valid. Lets the
 * daemon run fully end-to-end with no real Blocky402 integration. A real
 * client implementing this same interface slots in later with no other
 * code change.
 */
export class MockFacilitatorClient implements FacilitatorClient {
  private failNext: boolean;
  private readonly latencyMs: number;

  constructor(options: MockFacilitatorClientOptions = {}) {
    this.failNext = options.failNext ?? false;
    this.latencyMs = options.latencyMs ?? 0;
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, error: "mock_failure" };
    }
    // Shaped like a real Hedera transaction id (`0.0.acct@seconds.nanos`).
    // The protocol's receipt validator enforces that shape, so a mock that
    // minted `mock-...` made every receipt unpublishable — which silently
    // emptied the HCS topic in mock mode.
    const now = Date.now();
    const nanos = String((now % 1000) * 1_000_000 + input.blockIndex).padStart(9, "0");
    return { ok: true, txId: `${MOCK_PAYER_ACCOUNT}@${Math.floor(now / 1000)}.${nanos}` };
  }

  /** Test/demo helper: make the next call fail (e.g. to exercise retry behaviour). */
  setFailNext(fail: boolean): void {
    this.failNext = fail;
  }
}
