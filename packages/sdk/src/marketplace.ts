import type { BlockReceipt, MachineListing, PaymentRequirement } from "@bsp/protocol";
import { Job } from "./job.js";
import { FakePayer, type Payer } from "./payer.js";

type FetchLike = typeof globalThis.fetch;

export interface MachineRow extends MachineListing {
  live: boolean;
  lastSeenAt: string;
}

export interface MarketplaceOptions {
  /** Control plane base URL — used for discovery and placement only. */
  registryUrl: string;
  renterUaid: string;
  payer?: Payer;
  fetchImpl?: FetchLike;
}

export interface RentOptions {
  machine: string;
  image: string;
  cmd?: string[];
  env?: Record<string, string>;
  /**
   * Container port to publish. Give this for a workload that serves
   * something, and the job reports the URL it is reachable on while paid.
   */
  exposedPort?: number;
  budget: string;
  maxBlocks?: number;
  /** Poll interval for the renewal timer fallback. */
  fallbackIntervalMs?: number;
}

/**
 * The renter's entry point.
 *
 * Discovery and placement go through the control plane; everything after that
 * — the 402, the payment, the renewal stream, the artifacts — goes straight
 * to the provider's daemon. That split is the trust boundary the whole design
 * turns on: the marketplace operator cannot take the renter's money and cannot
 * stop their job.
 */
export class Marketplace {
  private readonly payer: Payer;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: MarketplaceOptions) {
    this.payer = opts.payer ?? new FakePayer();
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  private get registry(): string {
    return this.opts.registryUrl.replace(/\/$/, "");
  }

  /** Everything advertised, live or not. */
  async machines(opts: { liveOnly?: boolean } = {}): Promise<MachineRow[]> {
    const url = `${this.registry}/machines${opts.liveOnly ? "?live=true" : ""}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`registry ${res.status} listing machines`);
    return ((await res.json()) as { machines: MachineRow[] }).machines;
  }

  /**
   * Place a job, settle block 1, and hand back a live handle.
   *
   * Block 1 is paid before the provider provisions anything (SPEC §5.2), so
   * this resolves once the container is starting — not once it is ready. The
   * clock starts at ready, and the daemon tells the handle when.
   */
  async rent(options: RentOptions): Promise<Job> {
    const placement = await this.place(options);

    const job = new Job({
      jobId: placement.jobId,
      endpoint: placement.endpoint,
      budget: options.budget,
      maxBlocks: options.maxBlocks,
      pricePerBlock: placement.requirement.accepts[0]!.maxAmountRequired,
      blockSeconds: placement.requirement.blockMeta.blockSeconds,
      leadSeconds: placement.requirement.blockMeta.leadSeconds,
      payer: this.payer,
      fetchImpl: this.fetchImpl,
      ...(options.fallbackIntervalMs !== undefined
        ? { fallbackIntervalMs: options.fallbackIntervalMs }
        : {}),
    });

    const receipt = await this.settleFirstBlock(placement);
    job.noteInitialSettlement(receipt);
    job.start();
    return job;
  }

  private async place(options: RentOptions): Promise<{
    jobId: string;
    endpoint: string;
    requirement: PaymentRequirement;
  }> {
    const res = await this.fetchImpl(`${this.registry}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        machineId: options.machine,
        renterUaid: this.opts.renterUaid,
        image: options.image,
        cmd: options.cmd,
        env: options.env,
        exposedPort: options.exposedPort,
      }),
    });

    if (res.status !== 402) {
      throw new Error(`placement failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return (await res.json()) as {
      jobId: string;
      endpoint: string;
      requirement: PaymentRequirement;
    };
  }

  /** Block 1 gates provisioning, so it is settled before the handle goes live. */
  private async settleFirstBlock(placement: {
    jobId: string;
    endpoint: string;
    requirement: PaymentRequirement;
  }): Promise<BlockReceipt> {
    const proof = await this.payer.pay({
      jobId: placement.jobId,
      blockIndex: 1,
      requirement: placement.requirement,
    });

    const endpoint = placement.endpoint.replace(/\/$/, "");
    const res = await this.fetchImpl(`${endpoint}/jobs/${placement.jobId}/blocks/1/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(proof),
    });

    if (res.status !== 200) {
      throw new Error(`block 1 settlement failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return (await res.json()) as BlockReceipt;
  }
}
