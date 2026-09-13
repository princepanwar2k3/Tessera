/**
 * SPEC §6.1's v1 envelope, translated to the facilitator's x402 **v2** wire.
 *
 * The facilitator speaks v2 and this protocol's payment requirement is v1
 * (see `docs/facilitator-contract.md`). The translation lives here, in
 * `protocol`, for one reason: the renter signs a payload over these exact
 * requirements and the provider verifies it against its own copy. If the two
 * sides derived them independently, any disagreement — a field name, a
 * separator, how HBAR is spelled — would surface as an opaque signature
 * failure rather than as a mismatch anyone could see.
 *
 * One function, one output, both sides.
 */
import type { PaymentRequirement } from './wire.js';

export interface X402V2Requirements {
  scheme: 'exact';
  network: string;
  /** v2 names the amount `amount`; v1 called it `maxAmountRequired`. */
  amount: string;
  /** HBAR is `0.0.0` on the v2 wire; HTS tokens keep their own id. */
  asset: string;
  payTo: string;
  resource: string;
  description: string;
  maxTimeoutSeconds: number;
  /** The facilitator co-signs as fee payer; without this nothing settles. */
  extra: { feePayer: string };
}

export interface X402V2PaymentRequired {
  x402Version: 2;
  error: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: X402V2Requirements[];
}

/** Default settlement deadline the facilitator advertises. */
export const DEFAULT_MAX_TIMEOUT_SECONDS = 300;

/** `hedera-testnet` (v1, SPEC §6.1) -> `hedera:testnet` (v2, the facilitator). */
export function toV2Network(network: string): string {
  return network.replace(/^hedera-/, 'hedera:');
}

/** `HBAR` (v1, human) -> `0.0.0` (v2, the ledger's id for hbar). */
export function toV2Asset(asset: string): string {
  return asset === 'HBAR' ? '0.0.0' : asset;
}

export function toV2Requirements(
  requirement: PaymentRequirement,
  feePayer: string,
): X402V2Requirements {
  const accept = requirement.accepts[0];
  if (!accept) {
    throw new Error('payment requirement has no accepts[] entry to translate');
  }
  return {
    scheme: 'exact',
    network: toV2Network(accept.network),
    amount: accept.maxAmountRequired,
    asset: toV2Asset(accept.asset),
    payTo: accept.payTo,
    resource: accept.resource,
    description: accept.description,
    maxTimeoutSeconds: DEFAULT_MAX_TIMEOUT_SECONDS,
    extra: { feePayer },
  };
}

/**
 * The full `PaymentRequired` envelope the x402 client expects when building a
 * payload. Mirrors what the facilitator's own middleware puts in the
 * `PAYMENT-REQUIRED` header.
 */
export function toV2PaymentRequired(
  requirement: PaymentRequirement,
  feePayer: string,
): X402V2PaymentRequired {
  const requirements = toV2Requirements(requirement, feePayer);
  return {
    x402Version: 2,
    error: 'Payment required',
    resource: {
      url: requirements.resource,
      description: requirements.description,
      mimeType: 'application/json',
    },
    accepts: [requirements],
  };
}
