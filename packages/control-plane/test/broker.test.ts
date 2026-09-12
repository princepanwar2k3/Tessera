import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Db } from "../src/db.js";
import { Registry } from "../src/registry.js";
import { Broker } from "../src/broker.js";
import { BENCH_NAME, type MachineListing } from "@bsp/protocol";

function listing(overrides: Partial<MachineListing> = {}): MachineListing {
  return {
    machineId: "node-a",
    providerId: "provider-a",
    endpoint: "http://node-a.test:8080",
    specs: { cpuCores: 4, memoryMB: 8192, arch: "x64" },
    params: { blockSeconds: 30, leadSeconds: 10, pricePerBlock: "1500", asset: "HBAR" },
    benchmark: { name: BENCH_NAME, score: 1234, ranAt: "2026-09-10T00:00:00.000Z", selfReported: true },
    ...overrides,
  } as MachineListing;
}

const daemon402 = {
  x402Version: 1,
  accepts: [{ maxAmountRequired: "1500", payTo: "0.0.PROVIDER" }],
  blockMeta: { jobId: "j_abc123", blockIndex: 1, blockSeconds: 30 },
};

describe("Broker", () => {
  let db: Db;
  let now: number;
  let registry: Registry;
  let fetchMock: ReturnType<typeof vi.fn>;
  let broker: Broker;

  beforeEach(() => {
    db = openDatabase(":memory:");
    now = 1_757_844_000_000;
    registry = new Registry(db, () => now);
    registry.register({
      providerId: "provider-a",
      endpoint: "http://node-a.test:8080",
      machines: [listing()],
    });
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(daemon402), { status: 402, headers: { "content-type": "application/json" } }),
    );
    broker = new Broker(db, registry, fetchMock as never, () => now);
  });

  it("places a job on the chosen daemon and returns that daemon's direct URL", async () => {
    const result = await broker.place({
      machineId: "node-a",
      renterUaid: "uaid:test:renter",
      image: "busybox:latest",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected placement");
    expect(result.placement).toMatchObject({
      jobId: "j_abc123",
      machineId: "node-a",
      providerId: "provider-a",
      endpoint: "http://node-a.test:8080",
    });
  });

  it("creates the job against the daemon, never against itself", async () => {
    await broker.place({ machineId: "node-a", renterUaid: "uaid:r", image: "busybox:latest" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://node-a.test:8080/jobs");
  });

  it("sends the listing's own block parameters, not a caller-supplied price", async () => {
    await broker.place({ machineId: "node-a", renterUaid: "uaid:r", image: "busybox:latest" });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({
      blockSeconds: 30,
      leadSeconds: 10,
      pricePerBlock: "1500",
      asset: "HBAR",
    });
  });

  it("passes the daemon's 402 back untouched — it never mints its own", async () => {
    const result = await broker.place({
      machineId: "node-a",
      renterUaid: "uaid:r",
      image: "busybox:latest",
    });

    if (!result.ok) throw new Error("expected placement");
    // Byte-identical to what the daemon said. The control plane has no
    // opinion about the price (SPEC §3 I4).
    expect(result.requirement).toEqual(daemon402);
  });

  it("404s for an unknown machine", async () => {
    const result = await broker.place({
      machineId: "no-such-node",
      renterUaid: "uaid:r",
      image: "busybox:latest",
    });

    expect(result).toMatchObject({ ok: false, status: 404, error: "machine_not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to place on a machine whose heartbeat has gone stale", async () => {
    now += 10 * 60_000;

    const result = await broker.place({
      machineId: "node-a",
      renterUaid: "uaid:r",
      image: "busybox:latest",
    });

    expect(result).toMatchObject({ ok: false, status: 409, error: "machine_offline" });
  });

  it("reports an unreachable daemon rather than recording a phantom placement", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await broker.place({
      machineId: "node-a",
      renterUaid: "uaid:r",
      image: "busybox:latest",
    });

    expect(result).toMatchObject({ ok: false, status: 502, error: "daemon_unreachable" });
    expect(broker.listPlacements()).toHaveLength(0);
  });

  it("treats a non-402 daemon answer as a rejection", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "lead_time_floor" }), { status: 400 }),
    );

    const result = await broker.place({
      machineId: "node-a",
      renterUaid: "uaid:r",
      image: "busybox:latest",
    });

    expect(result).toMatchObject({ ok: false, status: 502, error: "daemon_rejected_job" });
  });

  it("remembers a placement so the console can find the daemon later", async () => {
    await broker.place({ machineId: "node-a", renterUaid: "uaid:r", image: "busybox:latest" });

    expect(broker.getPlacement("j_abc123")).toMatchObject({
      jobId: "j_abc123",
      endpoint: "http://node-a.test:8080",
    });
    expect(broker.listPlacements()).toHaveLength(1);
  });
});
