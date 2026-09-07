import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { PROVIDER_ID: "node-a" };

describe("receipt sink configuration", () => {
  it("defaults to the local sink and needs no Hedera credentials", () => {
    expect(loadConfig(base).receiptSink).toBe("local");
  });

  it("accepts the HCS sink when a topic and operator are configured", () => {
    const config = loadConfig({
      ...base,
      RECEIPT_SINK: "local+hcs",
      HCS_RECEIPT_TOPIC_ID: "0.0.5555",
      HEDERA_OPERATOR_ID: "0.0.4242",
      HEDERA_OPERATOR_KEY: "302e0201',",
    });
    expect(config.receiptSink).toBe("local+hcs");
    expect(config.hcsTopicId).toBe("0.0.5555");
  });

  it("refuses to boot with the HCS sink and no topic id, rather than publishing nowhere", () => {
    expect(() =>
      loadConfig({
        ...base,
        RECEIPT_SINK: "hcs",
        HEDERA_OPERATOR_ID: "0.0.4242",
        HEDERA_OPERATOR_KEY: "302e0201",
      }),
    ).toThrow(/HCS_RECEIPT_TOPIC_ID/);
  });

  it("refuses to boot with the HCS sink and no operator credentials", () => {
    expect(() =>
      loadConfig({ ...base, RECEIPT_SINK: "hcs", HCS_RECEIPT_TOPIC_ID: "0.0.5555" }),
    ).toThrow(/HEDERA_OPERATOR/);
  });
});
