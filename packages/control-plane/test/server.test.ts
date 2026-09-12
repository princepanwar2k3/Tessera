import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "../src/db.js";
import { Registry } from "../src/registry.js";
import { Broker } from "../src/broker.js";
import { ReceiptReader } from "../src/receipts.js";
import { buildServer } from "../src/server.js";
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
  accepts: [{ maxAmountRequired: "1500" }],
  blockMeta: { jobId: "j_abc123", blockIndex: 1 },
};

describe("control-plane HTTP surface", () => {
  let db: Db;
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = openDatabase(":memory:");
    const registry = new Registry(db);
    fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(daemon402), { status: 402 }));
    const broker = new Broker(db, registry, fetchMock as never);
    app = buildServer({ registry, broker, receipts: new ReceiptReader(undefined) });
  });

  async function register(machines = [listing()]) {
    return app.inject({
      method: "POST",
      url: "/providers",
      payload: { providerId: "provider-a", endpoint: "http://node-a.test:8080", machines },
    });
  }

  it("registers a provider", async () => {
    const res = await register();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, machines: 1 });
  });

  it("rejects a registration violating the SPEC 4.1 lead-time floor", async () => {
    const res = await register([
      listing({ params: { blockSeconds: 30, leadSeconds: 5, pricePerBlock: "1500", asset: "HBAR" } }),
    ]);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_listing");
  });

  it("rejects a malformed registration body", async () => {
    const res = await app.inject({ method: "POST", url: "/providers", payload: { providerId: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a heartbeat from a registered provider", async () => {
    await register();
    const res = await app.inject({ method: "POST", url: "/providers/provider-a/heartbeat" });
    expect(res.statusCode).toBe(200);
  });

  it("404s a heartbeat from a provider it has never seen", async () => {
    const res = await app.inject({ method: "POST", url: "/providers/ghost/heartbeat" });
    expect(res.statusCode).toBe(404);
  });

  it("lists machines with liveness", async () => {
    await register();
    const res = await app.inject({ method: "GET", url: "/machines" });

    expect(res.statusCode).toBe(200);
    expect(res.json().machines).toHaveLength(1);
    expect(res.json().machines[0]).toMatchObject({ machineId: "node-a", live: true });
  });

  it("lists nothing when no provider has ever registered", async () => {
    const res = await app.inject({ method: "GET", url: "/machines" });
    expect(res.json().machines).toEqual([]);
  });

  it("places a job and answers 402 with the daemon's direct URL", async () => {
    await register();
    const res = await app.inject({
      method: "POST",
      url: "/jobs",
      payload: { machineId: "node-a", renterUaid: "uaid:r", image: "busybox:latest" },
    });

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({
      jobId: "j_abc123",
      endpoint: "http://node-a.test:8080",
      payTo: "http://node-a.test:8080/jobs/j_abc123",
    });
    // The renter pays the daemon, using the daemon's own requirement.
    expect(res.json().requirement).toEqual(daemon402);
  });

  it("404s placement on an unknown machine", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/jobs",
      payload: { machineId: "ghost", renterUaid: "uaid:r", image: "busybox:latest" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("exposes a placement so the console can resolve a job to its daemon", async () => {
    await register();
    await app.inject({
      method: "POST",
      url: "/jobs",
      payload: { machineId: "node-a", renterUaid: "uaid:r", image: "busybox:latest" },
    });

    const res = await app.inject({ method: "GET", url: "/jobs/j_abc123" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ endpoint: "http://node-a.test:8080" });
  });

  it("answers 503 for receipts when no HCS topic is configured, rather than an empty list", async () => {
    // An empty history and "we aren't publishing" must never look the same.
    const res = await app.inject({ method: "GET", url: "/receipts?job=j_abc123" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("receipts_not_configured");
  });

  it("reports health including whether receipts are wired", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.json()).toMatchObject({ status: "ok", receiptsConfigured: false });
  });
});
