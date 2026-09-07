import type { HardwareSpecs } from "./specs.js";
import type { AttestationResult } from "./attestation.js";

export interface RegisterInput {
  providerId: string;
  specs: HardwareSpecs;
  attestation: AttestationResult;
}

export interface ControlPlaneClient {
  register(info: RegisterInput): Promise<{ providerId: string }>;
  heartbeat(providerId: string): Promise<void>;
}

/** Default: no control plane configured yet (P1's package doesn't exist). */
export class NoopControlPlaneClient implements ControlPlaneClient {
  async register(info: RegisterInput): Promise<{ providerId: string }> {
    return { providerId: info.providerId };
  }
  async heartbeat(): Promise<void> {
    // no-op
  }
}

/** Points at a real control-plane URL once packages/control-plane exists. */
export class HttpControlPlaneClient implements ControlPlaneClient {
  constructor(private readonly baseUrl: string) {}

  async register(info: RegisterInput): Promise<{ providerId: string }> {
    const res = await fetch(`${this.baseUrl}/providers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(info),
    });
    if (!res.ok) throw new Error(`control-plane register failed: ${res.status}`);
    return (await res.json()) as { providerId: string };
  }

  async heartbeat(providerId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/providers/${providerId}/heartbeat`, { method: "POST" });
    if (!res.ok) throw new Error(`control-plane heartbeat failed: ${res.status}`);
  }
}
