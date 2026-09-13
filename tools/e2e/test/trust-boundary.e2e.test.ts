import { afterEach, describe, expect, it } from "vitest";
import { startStack, type Stack } from "../src/fixture.js";
import { hbar, Marketplace } from "@bsp/sdk";

let stack: Stack | undefined;

afterEach(async () => {
  await stack?.close();
  stack = undefined;
});

/**
 * Kill the control plane mid-job and assert the job keeps running and keeps
 * billing. This test *is* the trust-boundary claim.
 *
 * The difference between a centralised marketplace with a crypto button and a
 * marketplace whose operator cannot take your money or stop your job.
 */
describe("trust boundary: the control plane is not in the payment path", () => {
  it("keeps running and keeps billing after the control plane dies", async () => {
    stack = await startStack();

    const job = await stack.marketplace.rent({
      machine: "node-a",
      image: "busybox:latest",
      budget: hbar(10),
      maxBlocks: 4,
      fallbackIntervalMs: 100,
    });

    const settledAfterKill: number[] = [];
    let killed = false;

    // Kill the operator the moment the job's first renewal settles.
    await new Promise<void>((resolve) => {
      job.on("block", (b) => {
        if (killed) {
          settledAfterKill.push(b.index);
          return;
        }
        if (b.index >= 2) {
          killed = true;
          void stack!.killControlPlane().then(resolve);
        }
      });
    });

    // The registry is genuinely gone.
    await expect(fetch(`${stack.controlPlane.url}/machines`)).rejects.toThrow();

    const result = await job.result();

    // The job ran to its block cap with no marketplace in existence.
    expect(result.blocksPaid).toBe(4);
    expect(settledAfterKill).toContain(4);
    expect(result.spent).toBe("6000");
    expect(result.receipts.map((r) => r.blockIndex)).toEqual([1, 2, 3, 4]);
  }, 80_000);

  it("still terminates deterministically at a boundary with the operator gone", async () => {
    stack = await startStack();

    const job = await stack.marketplace.rent({
      machine: "node-a",
      image: "busybox:latest",
      budget: "3000", // two blocks, then the renter can buy no more
      fallbackIntervalMs: 100,
    });

    await stack.killControlPlane();
    const result = await job.result();

    // I3 holds without the control plane: the provider's own watchdog ends
    // the job at the boundary, for non-renewal.
    expect(result.reason).toBe("unpaid_boundary");
    expect(result.blocksPaid).toBe(2);
  }, 60_000);

  it("never routes a payment through the control plane", async () => {
    stack = await startStack();
    const registryUrl = stack.controlPlane.url;
    const daemonUrl = stack.daemons[0]!.url;

    // Record every request this renter makes, by injection rather than by
    // patching globals — the SDK captures its fetch at construction.
    const seen: string[] = [];
    const recordingFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(typeof input === "string" ? input : input.toString());
      return fetch(input as never, init as never);
    }) as typeof fetch;

    const marketplace = new Marketplace({
      registryUrl,
      renterUaid: "uaid:test:renter",
      fetchImpl: recordingFetch,
    });

    const job = await marketplace.rent({
      machine: "node-a",
      image: "busybox:latest",
      budget: "3000",
      fallbackIntervalMs: 100,
    });
    await job.result();

    const payments = seen.filter((u) => u.includes("/payment"));
    expect(payments.length).toBeGreaterThan(0);
    // Every payment went to the provider, not the marketplace (SPEC §3, I4).
    expect(payments.every((u) => u.startsWith(daemonUrl))).toBe(true);
    expect(payments.some((u) => u.startsWith(registryUrl))).toBe(false);

    // The control plane was contacted exactly once: to place the job.
    expect(seen.filter((u) => u.startsWith(registryUrl))).toHaveLength(1);
  }, 60_000);
});
