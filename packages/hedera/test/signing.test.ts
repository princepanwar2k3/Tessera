import { describe, expect, it } from 'vitest';
import { PrivateKey } from '@hiero-ledger/sdk';
import type { BlockReceipt } from '@bsp/protocol';
import { signReceipt, verifyReceiptSignature } from '../src/signing.js';

const receipt = (over: Partial<BlockReceipt> = {}): BlockReceipt => ({
  v: 1,
  protocol: 'bsp/0.1',
  type: 'block_receipt',
  jobId: 'job_7',
  blockIndex: 3,
  asset: 'HBAR',
  amount: '100000',
  txId: '0.0.4242@1757844000.123456789',
  clockStartedAt: '2026-09-07T10:00:00.000Z',
  boundaryAt: '2026-09-07T10:01:30.000Z',
  ...over,
});

describe('receipt signing', () => {
  it("a provider's signature verifies against the provider's public key", () => {
    const key = PrivateKey.generateED25519();
    const signed = signReceipt(receipt(), key, 'provider');
    expect(signed.providerSig).toBeTypeOf('string');
    expect(verifyReceiptSignature(signed, key.publicKey, 'provider')).toBe(true);
  });

  it('keeps both signatures valid after the renter co-signs', () => {
    const provider = PrivateKey.generateED25519();
    const renter = PrivateKey.generateED25519();
    const cosigned = signReceipt(signReceipt(receipt(), provider, 'provider'), renter, 'renter');
    expect(verifyReceiptSignature(cosigned, provider.publicKey, 'provider')).toBe(true);
    expect(verifyReceiptSignature(cosigned, renter.publicKey, 'renter')).toBe(true);
  });

  it('rejects a receipt whose billed amount was altered after signing', () => {
    const key = PrivateKey.generateED25519();
    const signed = signReceipt(receipt(), key, 'provider');
    const tampered = { ...signed, amount: '999999' };
    expect(verifyReceiptSignature(tampered, key.publicKey, 'provider')).toBe(false);
  });

  it("rejects a receipt whose boundaryAt was shortened after signing (SPEC §8)", () => {
    const key = PrivateKey.generateED25519();
    const signed = signReceipt(receipt(), key, 'provider');
    const shortened = { ...signed, boundaryAt: '2026-09-07T10:00:45.000Z' };
    expect(verifyReceiptSignature(shortened, key.publicKey, 'provider')).toBe(false);
  });

  it("rejects another party's key, and an absent signature", () => {
    const key = PrivateKey.generateED25519();
    const impostor = PrivateKey.generateED25519();
    const signed = signReceipt(receipt(), key, 'provider');
    expect(verifyReceiptSignature(signed, impostor.publicKey, 'provider')).toBe(false);
    expect(verifyReceiptSignature(signed, key.publicKey, 'renter')).toBe(false);
    expect(verifyReceiptSignature(receipt(), key.publicKey, 'provider')).toBe(false);
  });

  it('does not mutate the receipt it was handed', () => {
    const key = PrivateKey.generateED25519();
    const original = receipt();
    signReceipt(original, key, 'provider');
    expect(original.providerSig).toBeUndefined();
  });
});
