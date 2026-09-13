import type { ResourceCaps } from "../spec/index.js";

export const DEFAULT_RESOURCE_CAPS: ResourceCaps = {
  memoryBytes: 512 * 1024 * 1024,
  cpus: 1,
  pidsLimit: 128,
  networkMode: "bridge",
  noNewPrivileges: true,
};

/**
 * dockerode HostConfig for a renter-supplied container. We are running
 * strangers' images: cap memory/cpu/pids, isolate the network mode the
 * listing declares, and make the root filesystem read-only with a small
 * tmpfs for scratch plus one bind-mounted artifact directory.
 */
export function buildHostConfig(
  caps: ResourceCaps,
  artifactHostDir: string,
  exposedPort?: number | undefined,
) {
  return {
    // Docker picks a free host port ("0"), which we read back after start.
    // Fixed ports would collide the moment two renters wanted the same one.
    ...(exposedPort !== undefined
      ? { PortBindings: { [`${exposedPort}/tcp`]: [{ HostPort: "0" }] } }
      : {}),
    Memory: caps.memoryBytes,
    NanoCpus: Math.round(caps.cpus * 1_000_000_000),
    PidsLimit: caps.pidsLimit ?? DEFAULT_RESOURCE_CAPS.pidsLimit,
    NetworkMode: caps.networkMode ?? DEFAULT_RESOURCE_CAPS.networkMode,
    ReadonlyRootfs: true,
    Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" },
    Binds: [`${artifactHostDir}:/artifacts:rw`],
    // Opt-out rather than opt-in: hardening is the default, and an operator
    // who disables it has to say so. See ResourceCaps.noNewPrivileges for the
    // host quirk that makes the escape hatch necessary.
    ...((caps.noNewPrivileges ?? true) ? { SecurityOpt: ["no-new-privileges"] } : {}),
  };
}
