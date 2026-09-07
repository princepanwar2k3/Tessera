/**
 * Receipt signatures — SPEC §6.2, §8.
 *
 * A receipt signed by the provider alone is evidence of a claim; a receipt
 * signed by both is evidence of agreement. Neither is evidence that the work
 * was done — that is out of scope (SPEC §9).
 */
import type { PrivateKey, PublicKey } from '@hiero-ledger/sdk';
import { receiptSigningBytes, type Receipt } from '@bsp/protocol';

export type SignerRole = 'provider' | 'renter';

const SIG_FIELD = { provider: 'providerSig', renter: 'renterSig' } as const;

export function signReceipt<R extends Receipt>(
  receipt: R,
  key: PrivateKey,
  role: SignerRole,
): R {
  const bytes = new TextEncoder().encode(receiptSigningBytes(receipt));
  const sig = Buffer.from(key.sign(bytes)).toString('base64');
  return { ...receipt, [SIG_FIELD[role]]: sig };
}

export function verifyReceiptSignature(
  receipt: Receipt,
  publicKey: PublicKey,
  role: SignerRole,
): boolean {
  const sig = (receipt as unknown as Record<string, unknown>)[SIG_FIELD[role]];
  if (typeof sig !== 'string' || sig.length === 0) return false;
  const bytes = new TextEncoder().encode(receiptSigningBytes(receipt));
  try {
    return publicKey.verify(bytes, Buffer.from(sig, 'base64'));
  } catch {
    return false;
  }
}
