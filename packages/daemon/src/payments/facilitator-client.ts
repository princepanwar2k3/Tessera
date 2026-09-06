import type { PaymentRequirement } from "../spec/index.js";

export interface VerifyPaymentInput {
  jobId: string;
  blockIndex: number;
  paymentProof: unknown;
  requirement: PaymentRequirement;
}

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
    return { ok: true, txId: `mock-${Date.now()}-${input.jobId}-${input.blockIndex}` };
  }

  /** Test/demo helper: make the next call fail (e.g. to exercise retry behaviour). */
  setFailNext(fail: boolean): void {
    this.failNext = fail;
  }
}
