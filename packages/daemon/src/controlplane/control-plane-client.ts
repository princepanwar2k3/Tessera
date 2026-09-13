import { assertValidMachineListing, type MachineListing } from "@bsp/protocol";
import type { HardwareSpecs } from "./specs.js";
import type { AttestationResult } from "./attestation.js";

export interface RegisterInput {
  providerId: string;
  /** This daemon's own base URL — what the renter pays and streams against. */
  endpoint: string;
  machines: MachineListing[];
}

/** What a node reports about itself between registrations. */
export interface Liveness {
  /** Jobs currently being served. Renters see this as the node's load. */
  activeJobs: number;
}

export interface ControlPlaneClient {
  register(info: RegisterInput): Promise<{ providerId: string }>;
  heartbeat(providerId: string, liveness?: Liveness): Promise<void>;
}

/** Default when no control plane is configured: the daemon runs standalone. */
export class NoopControlPlaneClient implements ControlPlaneClient {
  async register(info: RegisterInput): Promise<{ providerId: string }> {
    return { providerId: info.providerId };
  }
  async heartbeat(): Promise<void> {
    // no-op
  }
}

export class HttpControlPlaneClient implements ControlPlaneClient {
  constructor(private readonly baseUrl: string) {}

  async register(info: RegisterInput): Promise<{ providerId: string }> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/providers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(info),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`control-plane register failed: ${res.status} ${detail}`);
    }
    return (await res.json()) as { providerId: string };
  }

  async heartbeat(providerId: string, liveness?: Liveness): Promise<void> {
    const res = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/providers/${providerId}/heartbeat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(liveness ?? { activeJobs: 0 }),
      },
    );
    if (!res.ok) throw new Error(`control-plane heartbeat failed: ${res.status}`);
  }
}

export interface BuildListingInput {
  providerId: string;
  endpoint: string;
  specs: HardwareSpecs;
  attestation: AttestationResult;
  blockSeconds: number;
  leadSeconds: number;
  pricePerBlock: string;
  asset: string;
}

/**
 * The listing this daemon advertises.
 *
 * Validated here, at startup, against the same `protocol` validator the
 * registry will run — so a provider misconfigured below the SPEC §4.1
 * lead-time floor fails loudly on its own machine instead of being silently
 * refused by the registry and appearing simply absent.
 */
export function buildMachineListing(input: BuildListingInput): MachineListing {
  const listing: MachineListing = {
    machineId: input.providerId,
    providerId: input.providerId,
    endpoint: input.endpoint,
    specs: {
      cpuCores: input.specs.cpuCores,
      memoryMB: Math.floor(input.specs.totalMemoryBytes / (1024 * 1024)),
      arch: input.specs.arch,
    },
    params: {
      blockSeconds: input.blockSeconds,
      leadSeconds: input.leadSeconds,
      pricePerBlock: input.pricePerBlock,
      asset: input.asset,
    },
    benchmark: input.attestation,
  };

  assertValidMachineListing(listing);
  return listing;
}
