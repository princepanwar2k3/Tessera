import type { FastifyInstance } from "fastify";
import type { HardwareSpecs } from "../controlplane/specs.js";
import type { AttestationResult } from "../controlplane/attestation.js";

export interface HealthInfo {
  providerId: string;
  specs: HardwareSpecs;
  attestation: AttestationResult;
}

/**
 * Exposes what this node reported (or would report) to the control plane,
 * inspectable directly on the daemon without needing packages/control-plane
 * to exist. Same data, just visible standalone.
 */
export function registerHealthRoute(app: FastifyInstance, info: HealthInfo): void {
  app.get("/healthz", async () => ({ status: "ok", ...info }));
}
