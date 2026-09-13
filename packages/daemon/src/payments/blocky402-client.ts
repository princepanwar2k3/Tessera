import { toV2Requirements } from "@bsp/protocol";
import type {
  FacilitatorClient,
  VerifyPaymentInput,
  VerifyPaymentResult,
} from "./facilitator-client.js";
import type { Logger } from "../logging.js";

/**
 * Blocky402 facilitator client — x402 **v2**.
 *
 * Shapes are transcribed from `docs/facilitator-contract.md`, which records
 * the 402 and `/supported` legs as OBSERVED and the verify/settle legs as
 * PREDICTED. The predicted parts are NOT yet confirmed against a live
 * facilitator, because that needs a funded Hedera testnet ECDSA account.
 * Read the response-key handling below as "best known", not "verified".
 *
 * The v1 -> v2 translation lives in `@bsp/protocol` (`toV2Requirements`), not
 * here, because the renter signs a payload over those exact requirements and
 * this client verifies against its own copy. Deriving them in two places
 * would turn any disagreement into an opaque signature failure.
 *
 * Every Hedera requirement must carry `extra.feePayer` equal to the
 * facilitator's advertised signer: it co-signs as fee payer and submits the
 * transfer, so a requirement without it cannot settle.
 *
 * VERIFIED against the live facilitator on 2026-09-13 — verify returns
 * `{isValid, payer}`, settle returns `{success, transaction, network, payer}`,
 * and a duplicate settle FAILS with DUPLICATE_TRANSACTION and an empty
 * `transaction` (docs/facilitator-contract.md §3a). The facilitator is not
 * idempotent, so SPEC §6.3's guarantee is kept by the daemon's
 * `(jobId, blockIndex)` receipt guard, which runs before this client is ever
 * called.
 */
export interface Blocky402Options {
  baseUrl: string;
  /** Advertised fee payer from GET /supported, e.g. "0.0.7162784". */
  feePayer: string;
  timeoutMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}

export class Blocky402FacilitatorClient implements FacilitatorClient {
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(
    private readonly opts: Blocky402Options,
    private readonly logger: Logger,
  ) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const paymentRequirements = toV2Requirements(input.requirement, this.opts.feePayer);
    const body = {
      x402Version: 2,
      paymentPayload: input.paymentProof,
      paymentRequirements,
    };

    const verified = await this.post("/verify", body);
    if (!verified.ok) return { ok: false, error: verified.error };

    const valid = verified.body as { isValid?: boolean; invalidReason?: string; invalidMessage?: string };
    if (valid.isValid !== true) {
      return {
        ok: false,
        error: valid.invalidReason ?? valid.invalidMessage ?? "verify_rejected",
      };
    }

    // Verify and settle are separate calls; a verified-but-unsettled payment
    // is not money, so I1 is only satisfied once settle succeeds.
    const settled = await this.post("/settle", body);
    if (!settled.ok) return { ok: false, error: settled.error };

    const result = settled.body as {
      success?: boolean;
      transaction?: string;
      errorReason?: string;
      errorMessage?: string;
    };
    if (result.success !== true || !result.transaction) {
      return {
        ok: false,
        error: result.errorReason ?? result.errorMessage ?? "settle_failed",
      };
    }

    this.logger.info(
      { jobId: input.jobId, blockIndex: input.blockIndex, txId: result.transaction },
      "facilitator settled block",
    );
    return { ok: true, txId: result.transaction };
  }

  private async post(
    path: string,
    body: unknown,
  ): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 10_000);

    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        return { ok: false, error: `facilitator ${path} responded ${res.status}` };
      }
      return { ok: true, body: await res.json() };
    } catch (err) {
      // A timeout here is expected occasionally and is survivable: the renter
      // retries inside the renewal window (SPEC §7).
      const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : String(err);
      return { ok: false, error: `facilitator ${path} failed: ${reason}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
