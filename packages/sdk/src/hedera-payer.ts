import { toV2PaymentRequired, toV2Requirements } from "@bsp/protocol";
import type { Payer, PaymentContext } from "./payer.js";

/**
 * The real renter-side payer: signs an x402 v2 payload with a Hedera key.
 *
 * The provider's daemon hands back SPEC §6.1's v1 requirement; this
 * translates it with `@bsp/protocol`'s `toV2PaymentRequired` — the same
 * function the daemon uses to build what it verifies against — signs a
 * payload, and returns it as the payment proof. Deriving the requirements
 * from one shared function is what keeps the signature checkable: any
 * divergence between the two sides shows up as an opaque signature failure.
 *
 * Loaded lazily so `@bsp/sdk` stays importable in a browser bundle and in
 * offline tests that never touch Hedera.
 */
export interface HederaPayerOptions {
  accountId: string;
  /** Raw ECDSA private key hex. Hedera portal accounts are ECDSA. */
  privateKey: string;
  network?: "hedera:testnet" | "hedera:mainnet";
  /** The facilitator's advertised co-signer, from GET /supported. */
  feePayer: string;
  /**
   * Atomic per-payment ceiling, smallest units. HBAR is not a "default asset"
   * to x402's spend controls, so it must be opted in — and opting in with a
   * cap is safer than switching the controls off, which is the other way the
   * SDK suggests. The cap is what stops a misread requirement from spending
   * real money.
   */
  maxAmountPerPayment?: string;
}

export class HederaPayer implements Payer {
  private client?: unknown;

  constructor(private readonly opts: HederaPayerOptions) {}

  private get network(): "hedera:testnet" | "hedera:mainnet" {
    return this.opts.network ?? "hedera:testnet";
  }

  /** Built once, on first use, so importing this module costs nothing. */
  private async ensureClient(): Promise<{
    createPaymentPayload: (required: unknown) => Promise<unknown>;
  }> {
    if (this.client) {
      return this.client as { createPaymentPayload: (r: unknown) => Promise<unknown> };
    }

    const [{ x402Client }, hederaClient, hedera] = await Promise.all([
      import("@x402/core/client"),
      import("@x402/hedera/exact/client"),
      import("@x402/hedera"),
    ]);

    const signer = hedera.createClientHederaSigner(
      this.opts.accountId,
      hedera.PrivateKey.fromStringECDSA(this.opts.privateKey),
      { network: this.network },
    );

    const asset = {
      network: this.network,
      asset: "0.0.0",
      ...(this.opts.maxAmountPerPayment !== undefined
        ? { maxAmountPerPayment: this.opts.maxAmountPerPayment }
        : {}),
    };

    // NOTE: the x402Client constructor takes a requirements *selector*, not a
    // config object — a spendControls config passed there is silently ignored
    // and fails identically to not configuring anything.
    const client = new x402Client()
      .setSpendControls({ allowedAssets: [asset] })
      .register(this.network, new hederaClient.ExactHederaScheme(signer));

    this.client = client;
    return client as unknown as {
      createPaymentPayload: (r: unknown) => Promise<unknown>;
    };
  }

  async pay(ctx: PaymentContext): Promise<unknown> {
    const client = await this.ensureClient();
    const paymentRequired = toV2PaymentRequired(ctx.requirement, this.opts.feePayer);
    return client.createPaymentPayload(paymentRequired);
  }

  /** What the provider will verify this payload against. Exposed for tests. */
  requirementsFor(ctx: PaymentContext) {
    return toV2Requirements(ctx.requirement, this.opts.feePayer);
  }
}
