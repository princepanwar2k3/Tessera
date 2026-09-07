/**
 * The receipt topic — SPEC §6.2, §8.
 *
 * One shared HCS topic carries every job's receipts, keyed by `jobId`.
 * Per-job topics read better but cost a topic creation and its latency on the
 * critical path, and the boundary is the one place latency is not affordable.
 *
 * Consensus messages are the public, independently readable half of the
 * protocol: they are what makes a provider systematically shortening blocks
 * detectable rather than merely deniable.
 */
import { serializeReceiptCanonical, validateReceipt, type Receipt } from '@bsp/protocol';

export interface SubmitResult {
  txId: string;
  sequenceNumber: number;
}

export interface HcsMessage {
  contents: string;
  sequenceNumber: number;
  consensusTimestamp: string;
}

/**
 * The narrow slice of consensus service this package needs. The real adapter
 * wraps the Hedera SDK; tests drive a fake, so nothing here needs a network.
 */
export interface HcsClient {
  createTopic(opts: { memo: string }): Promise<string>;
  submitMessage(topicId: string, message: string): Promise<SubmitResult>;
  readMessages(topicId: string, opts?: { limit?: number }): Promise<HcsMessage[]>;
}

export class ReceiptTopic {
  constructor(
    private readonly hcs: HcsClient,
    readonly topicId: string,
  ) {}

  async publish(receipt: Receipt): Promise<SubmitResult> {
    const issues = validateReceipt(receipt);
    if (issues.length > 0) {
      // A consensus message cannot be retracted. Fail here, where it is still
      // a bug, rather than on the public log, where it is evidence.
      throw new Error(`refusing to publish invalid receipt: ${issues.join('; ')}`);
    }
    return this.hcs.submitMessage(this.topicId, serializeReceiptCanonical(receipt));
  }

  /**
   * Every receipt for one job, oldest block first, terminal receipt last.
   *
   * The topic is shared and public, so anything at all can appear on it.
   * Messages that are not well-formed BSP receipts are skipped rather than
   * raised: a stranger writing junk to the topic must not break a renter's
   * ability to audit their own job.
   */
  async receiptsFor(jobId: string, opts?: { limit?: number }): Promise<Receipt[]> {
    const messages = await this.hcs.readMessages(this.topicId, opts);
    const mine: Receipt[] = [];
    for (const m of messages) {
      const r = parseReceipt(m.contents);
      if (r !== undefined && r.jobId === jobId) mine.push(r);
    }
    return mine.sort(byBlockThenTerminal);
  }
}

function parseReceipt(contents: string): Receipt | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return undefined;
  }
  if (validateReceipt(parsed).length > 0) return undefined;
  return parsed as Receipt;
}

/** Block receipts in block order; a terminal receipt closes the sequence. */
function byBlockThenTerminal(a: Receipt, b: Receipt): number {
  const rank = (r: Receipt) =>
    r.type === 'block_receipt' ? r.blockIndex : Number.MAX_SAFE_INTEGER;
  return rank(a) - rank(b);
}

/** The memo every BSP receipt topic carries, so it is identifiable on HashScan. */
export const RECEIPT_TOPIC_MEMO = 'bsp/0.1 receipts';

/** Create the shared receipt topic. Run once per deployment, not per job. */
export async function createReceiptTopic(hcs: HcsClient): Promise<ReceiptTopic> {
  const topicId = await hcs.createTopic({ memo: RECEIPT_TOPIC_MEMO });
  return new ReceiptTopic(hcs, topicId);
}
