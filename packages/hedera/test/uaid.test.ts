import { describe, expect, it } from 'vitest';
import { isUaid, providerUaid, renterUaid, UAID_REGISTRY } from '../src/uaid.js';

const provider = { name: 'node-a', accountId: '0.0.10507867' } as const;
const renter = { name: '0.0.10401938', accountId: '0.0.10401938' } as const;

describe('HCS-14 agent identity', () => {
  it('mints a well-formed uaid:aid identifier', async () => {
    const uaid = await providerUaid(provider);

    expect(uaid.startsWith('uaid:aid:')).toBe(true);
    expect(isUaid(uaid)).toBe(true);
  });

  it('is deterministic — the same agent always gets the same id', async () => {
    expect(await providerUaid(provider)).toBe(await providerUaid(provider));
  });

  it('carries the registry and the Hedera account it transacts as', async () => {
    const uaid = await providerUaid(provider);

    expect(uaid).toContain(`registry=${UAID_REGISTRY}`);
    expect(uaid).toContain('nativeId=hedera:testnet:0.0.10507867');
  });

  it('gives different accounts different identities', async () => {
    const a = await providerUaid(provider);
    const b = await providerUaid({ name: 'node-a', accountId: '0.0.999' });

    expect(a).not.toBe(b);
  });

  it('separates the same account acting as provider and as renter', async () => {
    // One account can be both. They are two agents and must not share an id.
    const asProvider = await providerUaid(renter);
    const asRenter = await renterUaid(renter);

    expect(asProvider).not.toBe(asRenter);
  });

  it('distinguishes networks', async () => {
    const testnet = await providerUaid(provider);
    const mainnet = await providerUaid({ ...provider, network: 'mainnet' });

    expect(testnet).not.toBe(mainnet);
    expect(mainnet).toContain('nativeId=hedera:mainnet:');
  });

  it('rejects the hand-written strings receipts used to carry', () => {
    expect(isUaid('uaid:local:node-a')).toBe(false);
    expect(isUaid('node-a')).toBe(false);
  });
});
