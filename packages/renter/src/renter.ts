import { HederaPayer, Marketplace, type Job, type JobResult } from "@bsp/sdk";

export interface RenterConfig {
  registryUrl: string;
  accountId: string;
  privateKey: string;
  feePayer: string;
  network?: "hedera:testnet" | "hedera:mainnet";
  /** Assets this renter may be charged in, on the v2 wire. */
  allowedAssets?: string[];
  maxAmountPerPayment?: string;
}

export interface RentRequest {
  machineId: string;
  image: string;
  blocks: number;
  exposedPort?: number | undefined;
  cmd?: string[] | undefined;
  env?: Record<string, string> | undefined;
}

export interface ActiveJob {
  jobId: string;
  machineId: string;
  image: string;
  blocks: number;
  budget: string;
  asset: string;
  serviceUrl?: string | undefined;
  blocksPaid: number;
  spent: string;
  stopped: boolean;
  finished: boolean;
  reason?: string | undefined;
}

/**
 * The renter's own agent.
 *
 * It holds the key, and it is the only thing here that does. The console
 * drives it over localhost and never sees a secret; the marketplace never sees
 * one either. That division is the same one the protocol makes — whoever holds
 * the key is the only party that can spend — expressed as a process boundary
 * rather than a promise.
 *
 * A browser wallet replaces this without changing anything else: the console
 * would ask the wallet to sign instead of asking this.
 */
export class Renter {
  private readonly marketplace: Marketplace;
  private readonly jobs = new Map<string, { job: Job; state: ActiveJob }>();

  constructor(private readonly config: RenterConfig) {
    this.marketplace = new Marketplace({
      registryUrl: config.registryUrl,
      renterUaid: `uaid:testnet:${config.accountId}`,
      payer: new HederaPayer({
        accountId: config.accountId,
        privateKey: config.privateKey,
        network: config.network ?? "hedera:testnet",
        feePayer: config.feePayer,
        allowedAssets: config.allowedAssets ?? ["0.0.0"],
        ...(config.maxAmountPerPayment !== undefined
          ? { maxAmountPerPayment: config.maxAmountPerPayment }
          : {}),
      }),
    });
  }

  get accountId(): string {
    return this.config.accountId;
  }

  machines() {
    return this.marketplace.machines();
  }

  /** What a rental will cost, before committing to it. */
  async quote(machineId: string, blocks: number) {
    const machine = (await this.marketplace.machines()).find((m) => m.machineId === machineId);
    if (!machine) return undefined;
    return {
      machineId,
      blocks,
      pricePerBlock: machine.params.pricePerBlock,
      asset: machine.params.asset,
      blockSeconds: machine.params.blockSeconds,
      total: (BigInt(machine.params.pricePerBlock) * BigInt(blocks)).toString(),
      uptimeSeconds: machine.params.blockSeconds * blocks,
    };
  }

  async rent(request: RentRequest): Promise<ActiveJob> {
    const quote = await this.quote(request.machineId, request.blocks);
    if (!quote) throw new Error(`no machine "${request.machineId}" is listed`);

    const job = await this.marketplace.rent({
      machine: request.machineId,
      image: request.image,
      ...(request.cmd ? { cmd: request.cmd } : {}),
      ...(request.env ? { env: request.env } : {}),
      ...(request.exposedPort !== undefined ? { exposedPort: request.exposedPort } : {}),
      budget: quote.total,
      maxBlocks: request.blocks,
      fallbackIntervalMs: 500,
    });

    const state: ActiveJob = {
      jobId: job.id,
      machineId: request.machineId,
      image: request.image,
      blocks: request.blocks,
      budget: quote.total,
      asset: quote.asset,
      blocksPaid: job.settledBlocks,
      spent: job.totalSpent,
      stopped: false,
      finished: false,
    };

    job.on("block", () => {
      state.blocksPaid = job.settledBlocks;
      state.spent = job.totalSpent;
      state.serviceUrl = job.serviceUrl;
    });

    this.jobs.set(job.id, { job, state });
    void job.result().then((result: JobResult) => {
      state.finished = true;
      state.reason = result.reason;
      state.blocksPaid = result.blocksPaid;
      state.spent = result.spent;
      state.serviceUrl = undefined;
    });

    // The URL only exists once the container is up; give it a moment so the
    // caller usually gets it in the same response.
    await new Promise((r) => setTimeout(r, 1200));
    state.serviceUrl = job.serviceUrl;
    return state;
  }

  /**
   * The kill switch, as a button. Nothing is sent to the provider — the renter
   * stops buying and the job ends at the next boundary.
   */
  stopRenewing(jobId: string): ActiveJob | undefined {
    const entry = this.jobs.get(jobId);
    if (!entry) return undefined;
    entry.job.stopRenewing();
    entry.state.stopped = true;
    return entry.state;
  }

  get(jobId: string): ActiveJob | undefined {
    const entry = this.jobs.get(jobId);
    if (!entry) return undefined;
    entry.state.serviceUrl = entry.job.serviceUrl;
    entry.state.blocksPaid = entry.job.settledBlocks;
    entry.state.spent = entry.job.totalSpent;
    return entry.state;
  }

  list(): ActiveJob[] {
    return [...this.jobs.keys()].map((id) => this.get(id)!).reverse();
  }
}
