import { describe, expect, it } from 'vitest';
import { serializeReceiptCanonical, type BlockReceipt } from '../src/receipts.js';

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

describe('receipt canonical bytes (the Gate 2 contract)', () => {
  it('is independent of the order the fields were built in', () => {
    const a: BlockReceipt = receipt();
    const b = Object.fromEntries(
      Object.entries(a).reverse(),
    ) as unknown as BlockReceipt;
    expect(serializeReceiptCanonical(b)).toBe(serializeReceiptCanonical(a));
  });
});

describe('receipt signing bytes', () => {
  it('excludes the signatures, so both parties sign identical bytes', async () => {
    const { receiptSigningBytes } = await import('../src/receipts.js');
    const unsigned = receipt();
    const providerSigned = receipt({ providerSig: 'sig-from-the-provider' });
    const bothSigned = receipt({
      providerSig: 'sig-from-the-provider',
      renterSig: 'sig-from-the-renter',
    });
    expect(receiptSigningBytes(providerSigned)).toBe(receiptSigningBytes(unsigned));
    expect(receiptSigningBytes(bothSigned)).toBe(receiptSigningBytes(unsigned));
  });

  it('still covers every field that carries meaning', async () => {
    const { receiptSigningBytes } = await import('../src/receipts.js');
    const base = receipt();
    for (const [field, value] of [
      ['jobId', 'job_8'],
      ['blockIndex', 4],
      ['amount', '200000'],
      ['txId', '0.0.4242@1757844001.000000000'],
      ['boundaryAt', '2026-09-07T10:02:00.000Z'],
    ] as const) {
      expect(receiptSigningBytes({ ...base, [field]: value })).not.toBe(
        receiptSigningBytes(base),
      );
    }
  });
});
