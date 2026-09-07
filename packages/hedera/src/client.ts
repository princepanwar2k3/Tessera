/**
 * The real consensus-service adapter.
 *
 * Deliberately free of logic: every decision this protocol makes lives in
 * `ReceiptTopic` and is tested against a fake. What is left here is
 * translation between the Hedera SDK's shapes and ours, so the part that
 * cannot be verified without a funded testnet account is also the part with
 * nothing in it to get wrong.
 *
 * UNVERIFIED against a live network — no credentials in this workspace. See
 * docs/facilitator-contract.md §5, which still holds the Phase 0 gate.
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
}

export function clientFor(creds: OperatorCredentials): Client {
  const client =
    creds.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(creds.operatorId, PrivateKey.fromStringDer(creds.operatorKey));
  return client;
}

export function mirrorFor(network: 'testnet' | 'mainnet'): MirrorNodeReader {
  return new MirrorNodeReader({
    baseUrl: network === 'mainnet' ? MAINNET_MIRROR_NODE : TESTNET_MIRROR_NODE,
  });
}

export class HieroHcsClient implements HcsClient {
  constructor(
    private readonly client: Client,
    private readonly mirror: MirrorNodeReader = new MirrorNodeReader(),
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
