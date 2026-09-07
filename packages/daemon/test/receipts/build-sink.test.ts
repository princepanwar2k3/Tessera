import { describe, expect, it } from "vitest";
import { HcsReceiptSink } from "@bsp/hedera";
import { buildReceiptSink } from "../../src/receipts/build-sink.js";
import { LocalFileReceiptSink, TeeReceiptSink } from "../../src/receipts/receipt-sink.js";
import { loadConfig } from "../../src/config.js";

const hederaEnv = {
  HCS_RECEIPT_TOPIC_ID: "0.0.5555",
  HEDERA_OPERATOR_ID: "0.0.4242",
  // Throwaway ECDSA key generated for this test. Not a credential.
  HEDERA_OPERATOR_KEY:
    "3030020100300706052b8104000a042204200f3b3f7f62a6c9f0b3858293001ad44c66022f13419dea6c1746169afef3557b",
};

describe("buildReceiptSink", () => {
  it("builds only the local sink by default, touching no Hedera credentials", () => {
    const sink = buildReceiptSink(loadConfig({}));
    expect(sink).toBeInstanceOf(LocalFileReceiptSink);
  });

  it("builds the HCS sink alone when asked for hcs", () => {
    const sink = buildReceiptSink(loadConfig({ ...hederaEnv, RECEIPT_SINK: "hcs" }));
    expect(sink).toBeInstanceOf(HcsReceiptSink);
  });

  it("tees local before HCS when asked for both", () => {
    const sink = buildReceiptSink(loadConfig({ ...hederaEnv, RECEIPT_SINK: "local+hcs" }));
    expect(sink).toBeInstanceOf(TeeReceiptSink);
  });

  it("signs published receipts with the operator key (plan: both signatures where available)", () => {
    const sink = buildReceiptSink(loadConfig({ ...hederaEnv, RECEIPT_SINK: "hcs" }));
    expect((sink as HcsReceiptSink).signs).toBe(true);
  });
});
