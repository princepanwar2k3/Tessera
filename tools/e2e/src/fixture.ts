import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestDaemon, type TestDaemon } from "@bsp/daemon";
import { startTestControlPlane, type TestControlPlane } from "@bsp/control-plane";
import { Marketplace } from "@bsp/sdk";

export interface StackOptions {
  /** One entry per provider daemon to start. */
  nodes?: Array<{
    providerId: string;
    blockSeconds?: number;
    leadSeconds?: number;
    pricePerBlock?: string;
  }>;
}

export interface Stack {
  controlPlane: TestControlPlane;
  daemons: TestDaemon[];
  marketplace: Marketplace;
  /** Stop the control plane only — daemons and jobs keep running. */
  killControlPlane: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * The whole system, in one process: control plane, N provider daemons, and an
 * SDK pointed at the registry. Real HTTP between every part, real watchdog on
 * a real clock. Only Docker and the facilitator are doubles.
 */
export async function startStack(opts: StackOptions = {}): Promise<Stack> {
  const nodes = opts.nodes ?? [{ providerId: "node-a" }];
  const dataDirs: string[] = [];
  const controlPlane = await startTestControlPlane();

  const daemons: TestDaemon[] = [];
  for (const node of nodes) {
    const dataDir = await mkdtemp(join(tmpdir(), `tessera-e2e-${node.providerId}-`));
    dataDirs.push(dataDir);

    const daemon = await startTestDaemon({
      dataDir,
      providerId: node.providerId,
      blockSeconds: node.blockSeconds ?? 5,
      leadSeconds: node.leadSeconds ?? 4,
      pricePerBlock: node.pricePerBlock ?? "1500",
      watchdogIntervalMs: 100,
      graceMs: 100,
    });
    daemons.push(daemon);

    const res = await fetch(`${controlPlane.url}/providers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: daemon.providerId,
        endpoint: daemon.url,
        machines: [daemon.listing],
      }),
    });
    if (res.status !== 201) {
      throw new Error(`registration failed: ${res.status} ${await res.text()}`);
    }
  }

  let controlPlaneAlive = true;

  return {
    controlPlane,
    daemons,
    marketplace: new Marketplace({
      registryUrl: controlPlane.url,
      renterUaid: "uaid:test:renter",
    }),
    killControlPlane: async () => {
      if (!controlPlaneAlive) return;
      controlPlaneAlive = false;
      await controlPlane.close();
    },
    close: async () => {
      if (controlPlaneAlive) await controlPlane.close();
      await Promise.all(daemons.map((d) => d.close()));
      await Promise.all(dataDirs.map((d) => rm(d, { recursive: true, force: true })));
    },
  };
}
