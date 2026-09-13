import { describe, expect, it } from 'vitest';
import {
  toV2Asset,
  toV2Network,
  toV2PaymentRequired,
  toV2Requirements,
} from '../src/x402v2.js';
import type { PaymentRequirement } from '../src/wire.js';

const FEE_PAYER = '0.0.7162784';

function requirement(over: Partial<PaymentRequirement['accepts'][0]> = {}): PaymentRequirement {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'hedera-testnet',
        asset: 'HBAR',
        payTo: '0.0.10507867',
        maxAmountRequired: '100000',
        resource: '/jobs/j_1/blocks/2',
        description: 'Block 2 of 20s on node-a',
        facilitator: 'https://api.testnet.blocky402.com',
        ...over,
      },
    ],
    blockMeta: {
      protocol: 'bsp/0.1',
      jobId: 'j_1',
      blockIndex: 2,
      blockSeconds: 20,
      leadSeconds: 8,
      windowOpensAt: '2026-09-14T10:00:12.000Z',
      boundaryAt: '2026-09-14T10:00:20.000Z',
    },
  } as PaymentRequirement;
}

describe('v1 envelope to the facilitator v2 wire', () => {
  it('renames maxAmountRequired to amount', () => {
    expect(toV2Requirements(requirement(), FEE_PAYER).amount).toBe('100000');
  });

  it('spells HBAR as asset 0.0.0', () => {
    expect(toV2Asset('HBAR')).toBe('0.0.0');
    expect(toV2Requirements(requirement(), FEE_PAYER).asset).toBe('0.0.0');
  });

  it('leaves an HTS token id alone', () => {
    expect(toV2Asset('0.0.429274')).toBe('0.0.429274');
  });

  it('converts the network separator', () => {
    expect(toV2Network('hedera-testnet')).toBe('hedera:testnet');
    expect(toV2Network('hedera-mainnet')).toBe('hedera:mainnet');
  });

  it('leaves a non-hedera network untouched', () => {
    expect(toV2Network('eip155:80002')).toBe('eip155:80002');
  });

  it('carries the fee payer, without which nothing settles', () => {
    expect(toV2Requirements(requirement(), FEE_PAYER).extra).toEqual({ feePayer: FEE_PAYER });
  });

  it('is deterministic — both sides must derive identical bytes', () => {
    // The renter signs over these requirements and the provider verifies
    // against its own copy; any divergence surfaces as an opaque signature
    // failure rather than a visible mismatch.
    const a = toV2Requirements(requirement(), FEE_PAYER);
    const b = toV2Requirements(requirement(), FEE_PAYER);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('wraps requirements in the PaymentRequired envelope the client expects', () => {
    const envelope = toV2PaymentRequired(requirement(), FEE_PAYER);
    expect(envelope.x402Version).toBe(2);
    expect(envelope.accepts).toHaveLength(1);
    expect(envelope.resource.url).toBe('/jobs/j_1/blocks/2');
    expect(envelope.accepts[0]).toEqual(toV2Requirements(requirement(), FEE_PAYER));
  });

  it('refuses a requirement with no accepts entry rather than signing nothing', () => {
    const empty = { ...requirement(), accepts: [] } as unknown as PaymentRequirement;
    expect(() => toV2Requirements(empty, FEE_PAYER)).toThrow(/no accepts/);
  });
});
