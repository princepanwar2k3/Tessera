import { describe, expect, it } from 'vitest';
import { PrivateKey } from '@hiero-ledger/sdk';
import { hcsClientFor, mirrorFor, MAINNET_MIRROR_NODE, TESTNET_MIRROR_NODE } from '../src/index.js';

const creds = (network: 'testnet' | 'mainnet') => ({
  network,
  operatorId: '0.0.4242',
  operatorKey: PrivateKey.generateECDSA().toStringDer(),
});

describe('network wiring', () => {
  it('reads from the mirror node of the network it writes to', () => {
    // Reading mainnet receipts off the testnet mirror returns an empty
    // history, which is indistinguishable from a provider publishing nothing.
    expect(hcsClientFor(creds('mainnet')).mirror.baseUrl).toBe(MAINNET_MIRROR_NODE);
    expect(hcsClientFor(creds('testnet')).mirror.baseUrl).toBe(TESTNET_MIRROR_NODE);
  });

  it('exposes the mirror base url, so an operator can see where reads go', () => {
    expect(mirrorFor('testnet').baseUrl).toBe(TESTNET_MIRROR_NODE);
  });
});
