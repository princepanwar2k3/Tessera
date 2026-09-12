/**
 * The real consensus-service adapter.
 *
 * Deliberately free of logic: every decision this protocol makes lives in
 * `ReceiptTopic` and is tested against a fake. What is left here is
 * translation between the Hedera SDK's shapes and ours, so the part that
 * cannot be verified without a funded testnet account is also the part with
 * nothing in it to get wrong.
 *
 * Verified against Hedera testnet on 2026-09-13 (topic create, message
 * submit, mirror read). See docs/facilitator-contract.md.
 */
import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from '@hiero-ledger/sdk';
import type { HcsClient, HcsMessage, SubmitResult } from './topic.js';
import { MirrorNodeReader, TESTNET_MIRROR_NODE, MAINNET_MIRROR_NODE } from './mirror.js';

export interface OperatorCredentials {
  network: 'testnet' | 'mainnet';
  operatorId: string;
  operatorKey: string;
  /**
   * How to parse `operatorKey`. Omit to detect it — see `parsePrivateKey`.
   * Set it explicitly when the key is a raw ED25519 hex string, which is
   * indistinguishable from raw ECDSA by shape alone.
   */
  keyType?: 'ecdsa' | 'ed25519' | 'der';
}

/** DER-encoded Hedera private keys start with a SEQUENCE header. */
const DER_PREFIX = /^(0x)?30[0-9a-fA-F]{2}/;

/**
 * Parse an operator key without guessing wrong in silence.
 *
 * Using the wrong parser does not throw: it yields a valid-looking key that
 * signs nothing the network accepts, and every transaction comes back
 * `INVALID_SIGNATURE` with no hint that the key was the problem. That cost a
 * live debugging session, so the detection is explicit here and overridable.
 *
 * Raw ECDSA and raw ED25519 are both 64 hex characters and cannot be told
 * apart by shape. ECDSA is the default because Hedera's portal issues ECDSA
 * accounts and x402 requires them; pass `keyType: 'ed25519'` otherwise.
 */
export function parsePrivateKey(key: string, keyType?: OperatorCredentials['keyType']): PrivateKey {
  const trimmed = key.trim();
  const explicit = keyType ?? (DER_PREFIX.test(trimmed) ? 'der' : 'ecdsa');

  switch (explicit) {
    case 'der':
      return PrivateKey.fromStringDer(trimmed);
    case 'ed25519':
      return PrivateKey.fromStringED25519(trimmed);
    case 'ecdsa':
      return PrivateKey.fromStringECDSA(trimmed);
  }
}

export function clientFor(creds: OperatorCredentials): Client {
  const client =
    creds.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(creds.operatorId, parsePrivateKey(creds.operatorKey, creds.keyType));
  return client;
}

export function mirrorFor(network: 'testnet' | 'mainnet'): MirrorNodeReader {
  return new MirrorNodeReader({
    baseUrl: network === 'mainnet' ? MAINNET_MIRROR_NODE : TESTNET_MIRROR_NODE,
  });
}

/**
 * Build a consensus client whose writes and reads are on the same network.
 *
 * Wiring them separately is a mistake waiting to happen: mainnet receipts
 * read off the testnet mirror come back as an empty history, which looks
 * exactly like a provider that never published anything.
 */
export function hcsClientFor(creds: OperatorCredentials): HieroHcsClient {
  return new HieroHcsClient(clientFor(creds), mirrorFor(creds.network));
}

export class HieroHcsClient implements HcsClient {
  constructor(
    private readonly client: Client,
    readonly mirror: MirrorNodeReader = new MirrorNodeReader(),
  ) {}

  /**
   * No admin key and no submit key: the topic is immutable and open. That is
   * the right shape for a public evidence log — nobody, including us, can
   * rewrite it — and it is why `ReceiptTopic.receiptsFor` tolerates noise.
   */
  async createTopic(opts: { memo: string }): Promise<string> {
    const submitted = await new TopicCreateTransaction()
      .setTopicMemo(opts.memo)
      .execute(this.client);
    const receipt = await submitted.getReceipt(this.client);
    const topicId = receipt.topicId;
    if (topicId === null) throw new Error('topic creation returned no topic id');
    return topicId.toString();
  }

  async submitMessage(topicId: string, message: string): Promise<SubmitResult> {
    const submitted = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(message)
      .execute(this.client);
    const receipt = await submitted.getReceipt(this.client);
    return {
      txId: submitted.transactionId.toString(),
      sequenceNumber: receipt.topicSequenceNumber?.toNumber() ?? 0,
    };
  }

  readMessages(topicId: string, opts?: { limit?: number }): Promise<HcsMessage[]> {
    return this.mirror.readMessages(topicId, opts);
  }
}
