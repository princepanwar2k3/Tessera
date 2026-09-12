import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../src/db.js";
import { LIVENESS_TIMEOUT_MS, Registry } from "../src/registry.js";
import { BENCH_NAME, type MachineListing } from "@bsp/protocol";

function listing(overrides: Partial<MachineListing> = {}): MachineListing {
  return {
    machineId: "node-a",
    providerId: "provider-a",
    endpoint: "http://127.0.0.1:8080",
    specs: { cpuCores: 4, memoryMB: 8192, arch: "x64" },
    params: { blockSeconds: 30, leadSeconds: 10, pricePerBlock: "1500", asset: "HBAR" },
    benchmark: {
      name: BENCH_NAME,
      score: 1234,
      ranAt: "2026-09-10T00:00:00.000Z",
      selfReported: true,
    },
    ...overrides,
  } as MachineListing;
}

describe("Registry", () => {
  let db: Db;
  let now: number;
  let registry: Registry;

  beforeEach(() => {
    db = openDatabase(":memory:");
    now = 1_757_844_000_000;
    registry = new Registry(db, () => now);
  });

  it("registers a provider and lists its machines", () => {
    const result = registry.register({
      providerId: "provider-a",
      endpoint: "http://127.0.0.1:8080",
      machines: [listing()],
    });

    expect(result).toMatchObject({ ok: true, machines: 1 });
    expect(registry.listMachines()).toHaveLength(1);
    expect(registry.listMachines()[0]).toMatchObject({ machineId: "node-a", live: true });
  });

  it("rejects a listing that violates the SPEC 4.1 lead-time floor", () => {
    // 30s blocks need lead >= ceil(0.3 * 30) = 9s. 5s is below the floor.
    const result = registry.register({
      providerId: "provider-a",
      endpoint: "http://127.0.0.1:8080",
      machines: [
        listing({
          params: { blockSeconds: 30, leadSeconds: 5, pricePerBlock: "1500", asset: "HBAR" },
        }),
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.issues.some((i) => i.field.includes("leadSeconds"))).toBe(true);
    expect(registry.listMachines()).toHaveLength(0);
  });

  it("rejects a lead time that spans the whole block", () => {
    const result = registry.register({
      providerId: "provider-a",
      endpoint: "http://127.0.0.1:8080",
      machines: [
        listing({
          params: { blockSeconds: 10, leadSeconds: 10, pricePerBlock: "1500", asset: "HBAR" },
        }),
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a machine claiming a different provider than the registrant", () => {
    const result = registry.register({
      providerId: "provider-a",
      endpoint: "http://127.0.0.1:8080",
      machines: [listing({ providerId: "someone-else" })],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.issues.some((i) => i.code === "provider_mismatch")).toBe(true);
  });

  it("treats re-registration as the whole truth, dropping withdrawn machines", () => {
    registry.register({
      providerId: "provider-a",
      endpoint: "http://127.0.0.1:8080",
      machines: [listing({ machineId: "node-a" }), listing({ machineId: "node-b" })],
    });
    expect(registry.listMachines()).toHaveLength(2);

    registry.register({
      providerId: "provider-a",
      endpoint: "http://127.0.0.1:8080",
      machines: [listing({ machineId: "node-a" })],
    });

    expect(registry.listMachines().map((m) => m.machineId)).toEqual(["node-a"]);
  });

  it("marks a machine offline once the heartbeat goes stale", () => {
    registry.register({
      providerId: "provider-a",
      endpoint: "http://127.0.0.1:8080",
      machines: [listing()],
    });

    now += LIVENESS_TIMEOUT_MS + 1;

    expect(registry.listMachines()[0]!.live).toBe(false);
    // Still listed: "no machines online" and "this node went away" differ.
    expect(registry.listMachines()).toHaveLength(1);
    expect(registry.listMachines({ liveOnly: true })).toHaveLength(0);
  });

  it("brings a stale machine back on the next heartbeat", () => {
    registry.register({
      providerId: "provider-a",
      endpoint: "http://127.0.0.1:8080",
      machines: [listing()],
    });
    now += LIVENESS_TIMEOUT_MS + 1;
    expect(registry.listMachines()[0]!.live).toBe(false);

    expect(registry.heartbeat("provider-a")).toBe(true);

    expect(registry.listMachines()[0]!.live).toBe(true);
  });

  it("tolerates one missed heartbeat without flapping offline", () => {
    registry.register({
      providerId: "provider-a",
      endpoint: "http://127.0.0.1:8080",
      machines: [listing()],
    });

    now += 31_000; // one 30s beat missed

    expect(registry.listMachines()[0]!.live).toBe(true);
  });

  it("reports an unknown provider's heartbeat as unknown", () => {
    expect(registry.heartbeat("never-registered")).toBe(false);
  });
});
