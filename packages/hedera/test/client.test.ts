import { describe, expect, it } from 'vitest';
import { PrivateKey } from '@hiero-ledger/sdk';
import { hcsClientFor, mirrorFor, parsePrivateKey, MAINNET_MIRROR_NODE, TESTNET_MIRROR_NODE } from '../src/index.js';

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

describe("parsePrivateKey", () => {
  // Raw ECDSA: 64 hex chars, no DER prefix. This is what portal.hedera.com
  // issues and what x402 requires. Generated here rather than pinned, so no
  // real key is ever committed — the parser cares about encoding, not value.
  const RAW_ECDSA = PrivateKey.generateECDSA().toStringRaw();

  it("reads a raw ECDSA hex key by default", () => {
    const key = parsePrivateKey(RAW_ECDSA);
    expect(key.toStringRaw()).toBe(RAW_ECDSA);
  });

  it("round-trips through DER when told the key is DER", () => {
    const der = parsePrivateKey(RAW_ECDSA).toStringDer();
    expect(parsePrivateKey(der, "der").toStringRaw()).toBe(RAW_ECDSA);
  });

  it("detects a DER-encoded key without being told", () => {
    const der = parsePrivateKey(RAW_ECDSA).toStringDer();
    expect(parsePrivateKey(der).toStringRaw()).toBe(RAW_ECDSA);
  });

  it("honours an explicit ed25519 keyType", () => {
    // Raw ED25519 is also 64 hex characters, so shape cannot disambiguate it;
    // parsing the same bytes both ways must give different keys.
    const asEcdsa = parsePrivateKey(RAW_ECDSA, "ecdsa");
    const asEd25519 = parsePrivateKey(RAW_ECDSA, "ed25519");
    expect(asEd25519.publicKey.toStringRaw()).not.toBe(asEcdsa.publicKey.toStringRaw());
  });

  it("tolerates surrounding whitespace from a pasted .env value", () => {
    expect(parsePrivateKey(`  ${RAW_ECDSA}\n`).toStringRaw()).toBe(RAW_ECDSA);
  });
});
