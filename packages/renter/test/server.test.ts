import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import type { Renter, ActiveJob } from "../src/renter.js";

function activeJob(over: Partial<ActiveJob> = {}): ActiveJob {
  return {
    jobId: "j_1",
    machineId: "node-a",
    image: "tessera-demo-site:latest",
    blocks: 10,
    budget: "250",
    asset: "0.0.10518829",
    serviceUrl: "http://127.0.0.1:32942",
    blocksPaid: 1,
    spent: "25",
    stopped: false,
    finished: false,
    ...over,
  };
}

/** A Renter-shaped stub: the HTTP contract is what the console depends on. */
function stubRenter(over: Partial<Renter> = {}): Renter {
  return {
    accountId: "0.0.10401938",
    machines: vi.fn().mockResolvedValue([]),
    quote: vi.fn().mockResolvedValue({
      machineId: "node-a",
      blocks: 10,
      pricePerBlock: "25",
      asset: "0.0.10518829",
      blockSeconds: 15,
      total: "250",
      uptimeSeconds: 150,
    }),
    rent: vi.fn().mockResolvedValue(activeJob()),
    stopRenewing: vi.fn().mockReturnValue(activeJob({ stopped: true })),
    get: vi.fn().mockReturnValue(activeJob()),
    list: vi.fn().mockReturnValue([activeJob()]),
    ...over,
  } as unknown as Renter;
}

describe("renter agent HTTP surface", () => {
  it("identifies which account is paying", async () => {
    const res = await buildServer(stubRenter()).inject({ method: "GET", url: "/whoami" });

    expect(res.json()).toEqual({ accountId: "0.0.10401938", connected: true });
  });

  it("quotes a rental before any money moves", async () => {
    const res = await buildServer(stubRenter()).inject({
      method: "GET",
      url: "/quote?machine=node-a&blocks=10",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: "250", uptimeSeconds: 150 });
  });

  it("rejects a quote with no machine", async () => {
    const res = await buildServer(stubRenter()).inject({ method: "GET", url: "/quote?blocks=4" });
    expect(res.statusCode).toBe(400);
  });

  it("404s a quote for a machine nobody lists", async () => {
    const renter = stubRenter({ quote: vi.fn().mockResolvedValue(undefined) } as never);
    const res = await buildServer(renter).inject({
      method: "GET",
      url: "/quote?machine=ghost&blocks=4",
    });
    expect(res.statusCode).toBe(404);
  });

  it("rents and returns the live site URL", async () => {
    const res = await buildServer(stubRenter()).inject({
      method: "POST",
      url: "/rent",
      payload: { machineId: "node-a", image: "nginx", blocks: 10, exposedPort: 8080 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ jobId: "j_1", serviceUrl: "http://127.0.0.1:32942" });
  });

  it("rejects a rental with no blocks", async () => {
    const res = await buildServer(stubRenter()).inject({
      method: "POST",
      url: "/rent",
      payload: { machineId: "node-a", image: "nginx" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("reports why a rental failed rather than a bare 500", async () => {
    const renter = stubRenter({
      rent: vi.fn().mockRejectedValue(new Error("INSUFFICIENT_TOKEN_BALANCE")),
    } as never);

    const res = await buildServer(renter).inject({
      method: "POST",
      url: "/rent",
      payload: { machineId: "node-a", image: "nginx", blocks: 4 },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().detail).toMatch(/INSUFFICIENT_TOKEN_BALANCE/);
  });

  it("stops renewing a job it is paying for", async () => {
    const res = await buildServer(stubRenter()).inject({ method: "POST", url: "/jobs/j_1/stop" });

    expect(res.statusCode).toBe(200);
    expect(res.json().stopped).toBe(true);
  });

  it("404s stopping a job it never rented", async () => {
    const renter = stubRenter({ stopRenewing: vi.fn().mockReturnValue(undefined) } as never);
    const res = await buildServer(renter).inject({ method: "POST", url: "/jobs/nope/stop" });

    expect(res.statusCode).toBe(404);
  });

  it("lists what it is currently paying for", async () => {
    const res = await buildServer(stubRenter()).inject({ method: "GET", url: "/jobs" });

    expect(res.json().jobs).toHaveLength(1);
  });

  it("allows the console's origin — it runs on a different port", async () => {
    const res = await buildServer(stubRenter()).inject({ method: "GET", url: "/whoami" });

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});
