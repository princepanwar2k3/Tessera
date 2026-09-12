import { describe, expect, it, vi } from "vitest";
import { Marketplace } from "../src/marketplace.js";
import { FakeDaemon } from "./fake-daemon.js";
import { hbar } from "../src/amounts.js";

const REGISTRY = "http://registry.test";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Marketplace", () => {
  it("lists machines from the registry", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ machines: [{ machineId: "node-a", live: true }] }));
    const market = new Marketplace({
      registryUrl: REGISTRY,
      renterUaid: "uaid:r",
      fetchImpl: fetchImpl as never,
    });

    const machines = await market.machines();

    expect(machines).toHaveLength(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://registry.test/machines");
  });

  it("asks the registry for live machines only when requested", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ machines: [] }));
    const market = new Marketplace({
      registryUrl: REGISTRY,
      renterUaid: "uaid:r",
      fetchImpl: fetchImpl as never,
    });

    await market.machines({ liveOnly: true });

    expect(fetchImpl.mock.calls[0]![0]).toBe("http://registry.test/machines?live=true");
  });

  it("places through the registry, then settles block 1 against the daemon directly", async () => {
    const daemon = new FakeDaemon();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith(REGISTRY)) {
        return json(
          {
            jobId: "j_test",
            machineId: "node-a",
            providerId: "provider-a",
            endpoint: daemon.base,
            payTo: `${daemon.base}/jobs/j_test`,
            requirement: daemon.requirement(1),
          },
          402,
        );
      }
      return daemon.fetch(input, init);
    });

    const market = new Marketplace({
      registryUrl: REGISTRY,
      renterUaid: "uaid:r",
      fetchImpl: fetchImpl as never,
    });

    const job = await market.rent({
      machine: "node-a",
      image: "busybox:latest",
      budget: hbar(1),
      maxBlocks: 5,
      fallbackIntervalMs: 10_000,
    });

    expect(job.id).toBe("j_test");
    // Block 1 gates provisioning (SPEC §5.2) and is settled before the handle
    // goes live — and it is settled at the daemon, not the registry.
    expect(daemon.settled.has(1)).toBe(true);
    expect(job.settledBlocks).toBe(1);
    job.stopRenewing();
  });

  it("surfaces a placement rejection rather than returning a dead handle", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: "machine_offline" }, 409));
    const market = new Marketplace({
      registryUrl: REGISTRY,
      renterUaid: "uaid:r",
      fetchImpl: fetchImpl as never,
    });

    await expect(
      market.rent({ machine: "node-a", image: "busybox:latest", budget: hbar(1) }),
    ).rejects.toThrow(/placement failed: 409/);
  });
});
