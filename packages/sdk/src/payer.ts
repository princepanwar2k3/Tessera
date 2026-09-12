import type { PaymentRequirement } from "@bsp/protocol";

export interface PaymentContext {
  jobId: string;
  blockIndex: number;
  requirement: PaymentRequirement;
}

/**
 * How the renter actually settles a block.
 *
 * The seam that keeps the SDK offline-testable and facilitator-agnostic: BSP
 * is stock x402 on the payment path (SPEC §6.1), so a payer is free to be a
 * real facilitator client, a local signer, or the deterministic fake the
 * tests and CI use.
 */
export interface Payer {
  /** Produce the payment proof to submit to the daemon's block resource. */
  pay(ctx: PaymentContext): Promise<unknown>;
}

/**
 * Offline payer for dev and CI. Emits a proof shaped like the real thing and
 * carrying the amount it agreed to, so a daemon or fake facilitator that
 * checks the amount still exercises that path.
 */
export class FakePayer implements Payer {
  constructor(private readonly payerAccount = "0.0.999999") {}

  async pay(ctx: PaymentContext): Promise<unknown> {
    const accept = ctx.requirement.accepts[0];
    return {
      x402Version: 1,
      scheme: accept?.scheme ?? "exact",
      network: accept?.network ?? "hedera-testnet",
      payload: {
        from: this.payerAccount,
        to: accept?.payTo,
        asset: accept?.asset,
        amount: accept?.maxAmountRequired,
        jobId: ctx.jobId,
        blockIndex: ctx.blockIndex,
      },
    };
  }
}
