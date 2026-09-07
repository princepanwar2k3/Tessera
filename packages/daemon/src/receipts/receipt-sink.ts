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

/**
 * Fan a receipt out to several sinks, in order.
 *
 * Used to keep the local JSONL alongside HCS publishing. The order is the
 * point: the local append is synchronous and durable, so it happens first,
 * and a crash with receipts still queued for consensus loses nothing that
 * cannot be republished later.
 *
 * Errors are not caught here. The HCS sink is built never to throw (a
 * publish failure must not fail an already-settled payment), so what
 * propagates is a local write failure — which is what this already did
 * before the fan-out existed.
 */
export class TeeReceiptSink implements ReceiptSink {
  constructor(private readonly sinks: readonly ReceiptSink[]) {}

  async record(receipt: Receipt): Promise<void> {
    for (const sink of this.sinks) {
      await sink.record(receipt);
    }
  }
}
