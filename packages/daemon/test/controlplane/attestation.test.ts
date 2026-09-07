import { describe, expect, it } from "vitest";
import { BENCH_NAME, validateMachineListing } from "@bsp/protocol";
import { runBenchmark } from "../../src/controlplane/attestation.js";

describe("provider attestation benchmark", () => {
  it("runs the protocol's fixed benchmark, so two providers' scores compare", () => {
    // A daemon-local benchmark produces a number no other listing can be
    // measured against, which defeats the point of publishing one.
    expect(runBenchmark().name).toBe(BENCH_NAME);
  });

  it("produces a benchmark a machine listing will accept", () => {
    const issues = validateMachineListing({
      machineId: "node-a",
      providerId: "0.0.4242",
      endpoint: "https://node-a.example",
      specs: { cpuCores: 8, memoryMB: 16384, arch: "x86_64" },
      params: { blockSeconds: 30, leadSeconds: 10, pricePerBlock: "1500", asset: "HBAR" },
      benchmark: runBenchmark(),
    });
    expect(issues).toEqual([]);
  });

  it("is labelled self-reported, since BSP has no attestation (SPEC §9)", () => {
    expect(runBenchmark().selfReported).toBe(true);
  });
});
