import {
  HcsReceiptSink,
  HieroHcsClient,
  ReceiptTopic,
  clientFor,
  type OperatorCredentials,
} from "@bsp/hedera";
import type { Config } from "../config.js";
import type { Logger } from "../logging.js";
import { LocalFileReceiptSink, TeeReceiptSink, type ReceiptSink } from "./receipt-sink.js";

/**
 * Choose the receipt sink from configuration.
 *
 * `local+hcs` is the shape a real provider wants: the JSONL append is durable
 * and immediate, and HCS is the public log SPEC §8 relies on. Publishing
 * happens off the settlement path, so consensus latency never delays the
 * `200` that tells a renter their block is paid.
 *
 * Config has already rejected an HCS sink without a topic and operator, so
 * the non-null assertions here cannot fire.
 */
export function buildReceiptSink(config: Config, logger?: Logger): ReceiptSink {
  const local = new LocalFileReceiptSink(config.dataDir);
  if (config.receiptSink === "local") return local;

  const credentials: OperatorCredentials = {
    network: config.hederaNetwork,
    operatorId: config.hederaOperatorId!,
    operatorKey: config.hederaOperatorKey!,
  };
  const hcs = new HcsReceiptSink({
    topic: new ReceiptTopic(new HieroHcsClient(clientFor(credentials)), config.hcsTopicId!),
    onError: (error, receipt) => {
      // Loud, but never fatal: the block was paid whatever consensus did.
      logger?.error(
        { jobId: receipt.jobId, error: error.message },
        "failed to publish receipt to HCS",
      );
    },
  });

  return config.receiptSink === "hcs" ? hcs : new TeeReceiptSink([local, hcs]);
}
