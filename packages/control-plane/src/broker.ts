import type { Db } from "./db.js";
import type { MachineRow, Registry } from "./registry.js";

export interface PlaceJobInput {
  machineId: string;
  renterUaid: string;
  image: string;
  cmd?: string[] | undefined;
  env?: Record<string, string> | undefined;
  /** Container port to publish, for workloads that serve something. */
  exposedPort?: number | undefined;
}

export interface Placement {
  jobId: string;
  machineId: string;
  providerId: string;
  /** The daemon the renter pays and streams against, directly. */
  endpoint: string;
  renterUaid: string;
  placedAt: string;
}

export type PlaceResult =
  | { ok: true; placement: Placement; requirement: unknown }
  | { ok: false; status: number; error: string; detail?: unknown };

type FetchLike = typeof globalThis.fetch;

/**
 * The job broker.
 *
 * Placement is the *only* thing the control plane does for a running job: it
 * picks the machine, asks that daemon to create the job, and hands the renter
 * back the daemon's own URL along with the daemon's 402. From that moment the
 * renter pays the provider directly.
 *
 * The control plane never proxies a payment and never holds a key
 * (SPEC §3 I4, PLAN.md's trust boundary). If this process dies mid-job, the
 * job keeps running and keeps billing — `tools/e2e` asserts exactly that.
 */
export class Broker {
  constructor(
    private readonly db: Db,
    private readonly registry: Registry,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async place(input: PlaceJobInput): Promise<PlaceResult> {
    const machine = this.registry.getMachine(input.machineId);
    if (!machine) {
      return { ok: false, status: 404, error: "machine_not_found" };
    }
    if (!machine.live) {
      return { ok: false, status: 409, error: "machine_offline" };
    }

    const created = await this.createJobOnDaemon(machine, input);
    if (!created.ok) return created;

    const placement: Placement = {
      jobId: created.jobId,
      machineId: machine.machineId,
      providerId: machine.providerId,
      endpoint: machine.endpoint,
      renterUaid: input.renterUaid,
      placedAt: new Date(this.now()).toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO placements (job_id, machine_id, provider_id, endpoint, renter_uaid, placed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        placement.jobId,
        placement.machineId,
        placement.providerId,
        placement.endpoint,
        placement.renterUaid,
        this.now(),
      );

    return { ok: true, placement, requirement: created.requirement };
  }

  getPlacement(jobId: string): Placement | undefined {
    const row = this.db
      .prepare(
        `SELECT job_id AS jobId, machine_id AS machineId, provider_id AS providerId,
                endpoint, renter_uaid AS renterUaid, placed_at AS placedAt
           FROM placements WHERE job_id = ?`,
      )
      .get(jobId) as (Omit<Placement, "placedAt"> & { placedAt: number }) | undefined;
    return row ? { ...row, placedAt: new Date(row.placedAt).toISOString() } : undefined;
  }

  /**
   * Placements, newest first. `renter` narrows to one renter's own jobs — the
   * marketplace is public, but a renter watching their own spend should not
   * have to read past everyone else's.
   *
   * Matched on a suffix so a Hedera account id works as well as the full
   * uaid: `uaid:testnet:0.0.10401938` is what gets stored, and `0.0.10401938`
   * is what a person has to hand.
   */
  listPlacements(renter?: string): Placement[] {
    const select = `SELECT job_id AS jobId, machine_id AS machineId, provider_id AS providerId,
                           endpoint, renter_uaid AS renterUaid, placed_at AS placedAt
                      FROM placements`;

    const rows = (
      renter
        ? this.db
            .prepare(
              `${select} WHERE renter_uaid = ? OR renter_uaid LIKE ? ORDER BY placed_at DESC`,
            )
            .all(renter, `%${renter}`)
        : this.db.prepare(`${select} ORDER BY placed_at DESC`).all()
    ) as Array<Omit<Placement, "placedAt"> & { placedAt: number }>;

    return rows.map((r) => ({ ...r, placedAt: new Date(r.placedAt).toISOString() }));
  }

  /**
   * Ask the daemon to create the job. Its 402 is passed back to the renter
   * untouched — re-deriving the payment requirement here would put the control
   * plane's idea of the price between the renter and the provider, which is
   * precisely the position it must never occupy.
   */
  private async createJobOnDaemon(
    machine: MachineRow,
    input: PlaceJobInput,
  ): Promise<{ ok: true; jobId: string; requirement: unknown } | { ok: false; status: number; error: string; detail?: unknown }> {
    const body = {
      renterUaid: input.renterUaid,
      image: input.image,
      cmd: input.cmd,
      env: input.env,
      exposedPort: input.exposedPort,
      blockSeconds: machine.params.blockSeconds,
      leadSeconds: machine.params.leadSeconds,
      pricePerBlock: machine.params.pricePerBlock,
      asset: machine.params.asset,
    };

    let res: Response;
    try {
      res = await this.fetchImpl(`${machine.endpoint.replace(/\/$/, "")}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        status: 502,
        error: "daemon_unreachable",
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    // The daemon answers a job creation with 402 and the payment requirement.
    if (res.status !== 402) {
      return {
        ok: false,
        status: 502,
        error: "daemon_rejected_job",
        detail: { status: res.status, body: await safeJson(res) },
      };
    }

    const requirement = (await res.json()) as { blockMeta?: { jobId?: string } };
    const jobId = requirement.blockMeta?.jobId;
    if (!jobId) {
      return { ok: false, status: 502, error: "daemon_response_missing_job_id" };
    }

    return { ok: true, jobId, requirement };
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
