import { MirrorNodeReader } from "@bsp/hedera";
import { validateReceipt, type Receipt } from "@bsp/protocol";

export interface ReceiptQuery {
  jobId?: string | undefined;
  limit?: number | undefined;
}

/**
 * Read-through to the Hedera mirror node — SPEC §8.
 *
 * Deliberately not a cache of what the daemons told us. The point of
 * publishing receipts to HCS is that a renter can check the provider's claims
 * against consensus; serving our own copy back would defeat that. This reads
 * the topic and filters, nothing more.
 */
export class ReceiptReader {
  constructor(
    private readonly topicId: string | undefined,
    private readonly reader = new MirrorNodeReader(),
  ) {}

  get configured(): boolean {
    return this.topicId !== undefined;
  }

  async read(query: ReceiptQuery = {}): Promise<Receipt[]> {
    if (!this.topicId) return [];

    const messages = await this.reader.readMessages(
      this.topicId,
      query.limit === undefined ? {} : { limit: query.limit },
    );
    const receipts: Receipt[] = [];
    for (const message of messages) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.contents);
      } catch {
        continue; // a shared topic may carry anything; skip what isn't ours
      }
      if (validateReceipt(parsed).length > 0) continue;
      const receipt = parsed as Receipt;
      if (query.jobId && receipt.jobId !== query.jobId) continue;
      receipts.push(receipt);
    }
    return receipts;
  }
}
