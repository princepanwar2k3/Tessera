import os from "node:os";

export interface HardwareSpecs {
  cpuCores: number;
  cpuModel: string;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  platform: NodeJS.Platform;
  arch: string;
  hostname: string;
  osRelease: string;
}

/**
 * Static host info reported to the control plane at registration, and shown
 * on the provider's listing (PLAN.md's console mockup: "4 vCPU · 8 GB").
 * This is self-reported by the daemon, not independently verified — see
 * src/controlplane/attestation.ts for the (also self-reported, also
 * unverified) benchmark that raises the cost of lying about it.
 */
export function collectHardwareSpecs(): HardwareSpecs {
  const cpus = os.cpus();
  return {
    cpuCores: cpus.length,
    cpuModel: cpus[0]?.model ?? "unknown",
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    osRelease: os.release(),
  };
}
