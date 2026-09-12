import { describe, expect, it } from "vitest";
import { buildMachineListing } from "../../src/controlplane/control-plane-client.js";
import { collectHardwareSpecs } from "../../src/controlplane/specs.js";
import { runBenchmark } from "../../src/controlplane/attestation.js";
import { validateMachineListing } from "@bsp/protocol";

const base = {
  providerId: "node-a",
  endpoint: "http://127.0.0.1:8080",
  specs: collectHardwareSpecs(),
  attestation: runBenchmark(),
  blockSeconds: 30,
  leadSeconds: 10,
  pricePerBlock: "1500",
  asset: "HBAR",
};

describe("buildMachineListing", () => {
  it("produces a listing the registry's own validator accepts", () => {
    expect(validateMachineListing(buildMachineListing(base))).toEqual([]);
  });

  it("carries the listing's block parameters verbatim (SPEC 4)", () => {
    expect(buildMachineListing(base).params).toEqual({
      blockSeconds: 30,
      leadSeconds: 10,
      pricePerBlock: "1500",
      asset: "HBAR",
    });
  });

  it("reports memory in MB from the host's byte count", () => {
    const listing = buildMachineListing({
      ...base,
      specs: { ...base.specs, totalMemoryBytes: 8 * 1024 * 1024 * 1024 },
    });
    expect(listing.specs.memoryMB).toBe(8192);
  });

  it("refuses to advertise a lead time below the SPEC 4.1 floor", () => {
    // 30s blocks require lead >= ceil(0.3 * 30) = 9s.
    expect(() => buildMachineListing({ ...base, leadSeconds: 5 })).toThrow(/lead/i);
  });

  it("refuses a lead time spanning the whole block", () => {
    expect(() => buildMachineListing({ ...base, blockSeconds: 10, leadSeconds: 10 })).toThrow();
  });

  it("never presents the benchmark as attested (SPEC 9)", () => {
    expect(buildMachineListing(base).benchmark.selfReported).toBe(true);
  });
});
