import {
  validateMachineListing,
  type MachineListing,
  type MachineListingIssue,
} from "@bsp/protocol";
import type { Db } from "./db.js";

/**
 * How long after its last heartbeat a provider is still considered live.
 * The daemon heartbeats every 30s, so this tolerates one missed beat without
 * flapping a machine offline mid-demo.
 */
export const LIVENESS_TIMEOUT_MS = 90_000;

export interface RegisterProviderInput {
  providerId: string;
  endpoint: string;
  machines: MachineListing[];
}

export type RegisterResult =
  | { ok: true; providerId: string; machines: number }
  | { ok: false; issues: MachineListingIssue[] };

export interface MachineRow extends MachineListing {
  live: boolean;
  lastSeenAt: string;
}

/**
 * Registry and liveness. Discovery only — the control plane is never in the
 * payment path (PLAN.md), so nothing here touches a facilitator, holds a key,
 * or knows what a receipt is.
 */
export class Registry {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Register a provider and replace its advertised machines.
   *
   * A listing that violates the SPEC §4.1 lead-time floor is rejected here,
   * using `protocol`'s validator — the same one the daemon checks itself
   * against. A misconfigured provider must not be able to make the protocol
   * look broken by listing a window no renter could ever pay inside.
   */
  register(input: RegisterProviderInput): RegisterResult {
    const issues: MachineListingIssue[] = [];
    input.machines.forEach((machine, i) => {
      for (const issue of validateMachineListing(machine)) {
        issues.push({ ...issue, field: `machines[${i}].${issue.field}` });
      }
      if (machine.providerId !== input.providerId) {
        issues.push({
          field: `machines[${i}].providerId`,
          code: "provider_mismatch",
          message: `machine providerId "${machine.providerId}" does not match "${input.providerId}"`,
        });
      }
    });
    if (issues.length > 0) return { ok: false, issues };

    const at = this.now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO providers (provider_id, endpoint, registered_at, last_seen_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(provider_id) DO UPDATE SET endpoint = excluded.endpoint,
                                                  last_seen_at = excluded.last_seen_at`,
        )
        .run(input.providerId, input.endpoint, at, at);

      // Replace rather than merge: a provider's registration is the whole
      // truth about what it currently offers, so a machine it stopped
      // advertising must disappear.
      this.db.prepare(`DELETE FROM machines WHERE provider_id = ?`).run(input.providerId);
      const insert = this.db.prepare(
        `INSERT INTO machines (machine_id, provider_id, listing_json, updated_at) VALUES (?, ?, ?, ?)`,
      );
      for (const machine of input.machines) {
        insert.run(machine.machineId, input.providerId, JSON.stringify(machine), at);
      }
    });
    tx();

    return { ok: true, providerId: input.providerId, machines: input.machines.length };
  }

  /** Returns false if the provider was never registered. */
  heartbeat(providerId: string): boolean {
    const result = this.db
      .prepare(`UPDATE providers SET last_seen_at = ? WHERE provider_id = ?`)
      .run(this.now(), providerId);
    return result.changes > 0;
  }

  /**
   * Every advertised machine with liveness derived from the last heartbeat.
   * Offline machines are still listed — "no machines online" and "this node
   * went away" are different things, and the console says so.
   */
  listMachines(opts: { liveOnly?: boolean } = {}): MachineRow[] {
    const rows = this.db
      .prepare(
        `SELECT m.listing_json AS listingJson, p.last_seen_at AS lastSeenAt
           FROM machines m
           JOIN providers p ON p.provider_id = m.provider_id
          ORDER BY m.machine_id`,
      )
      .all() as Array<{ listingJson: string; lastSeenAt: number }>;

    const cutoff = this.now() - LIVENESS_TIMEOUT_MS;
    const machines = rows.map((row) => ({
      ...(JSON.parse(row.listingJson) as MachineListing),
      live: row.lastSeenAt >= cutoff,
      lastSeenAt: new Date(row.lastSeenAt).toISOString(),
    }));

    return opts.liveOnly ? machines.filter((m) => m.live) : machines;
  }

  getMachine(machineId: string): MachineRow | undefined {
    return this.listMachines().find((m) => m.machineId === machineId);
  }
}
