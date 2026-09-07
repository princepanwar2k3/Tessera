import { describe, expect, it } from "vitest";
import { TeeReceiptSink, type ReceiptSink } from "../../src/receipts/receipt-sink.js";
import type { BlockReceipt, Receipt } from "../../src/spec/index.js";

const receipt: BlockReceipt = {
  v: 1,
  protocol: "bsp/0.1",
  type: "block_receipt",
  jobId: "job-1",
  blockIndex: 2,
  providerUaid: "uaid:test:provider",
  renterUaid: "uaid:test:renter",
  asset: "MOCK",
  amount: "1500",
  txId: "0.0.1234@1757844000.123456789",
  clockStartedAt: "2026-09-07T10:00:00.000Z",
  boundaryAt: "2026-09-07T10:00:30.000Z",
};

class Recording implements ReceiptSink {
  recorded: Receipt[] = [];
  async record(r: Receipt): Promise<void> {
    this.recorded.push(r);
  }
}

describe("TeeReceiptSink", () => {
  it("records the receipt to every sink", async () => {
    const local = new Recording();
    const hcs = new Recording();
    await new TeeReceiptSink([local, hcs]).record(receipt);
    expect(local.recorded).toEqual([receipt]);
    expect(hcs.recorded).toEqual([receipt]);
  });

  it("writes durably before publishing, so a crash cannot lose the receipt", async () => {
    const order: string[] = [];
    const named = (name: string): ReceiptSink => ({
      record: async () => {
        order.push(name);
      },
    });
    await new TeeReceiptSink([named("local"), named("hcs")]).record(receipt);
    expect(order).toEqual(["local", "hcs"]);
  });
});
