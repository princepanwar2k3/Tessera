import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Receipt } from "../spec/index.js";

export interface ReceiptSink {
  record(receipt: Receipt): Promise<void>;
}

/**
 * Default receipt sink: append-only JSONL per job under dataDir/receipts.
 * A future HcsReceiptSink (P3's concern — publishing to Hedera Consensus
 * Service) slots in behind this same interface.
 */
export class LocalFileReceiptSink implements ReceiptSink {
  constructor(private readonly dataDir: string) {}

  async record(receipt: Receipt): Promise<void> {
    const path = join(this.dataDir, "receipts", `${receipt.jobId}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(receipt) + "\n", "utf-8");
  }
}
