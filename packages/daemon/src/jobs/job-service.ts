import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  validateLeadTime,
  windowOpensAt,
  type BlockReceipt,
  type ErrorBody,
  type Job,
  type PaymentRequirement,
} from "../spec/index.js";
import type { JobRegistry } from "./job-registry.js";
import type { JobStore } from "./job-store.js";
import type { Clock } from "./clock.js";
import type { DockerRunner } from "../docker/docker-runner.js";
import { DEFAULT_RESOURCE_CAPS } from "../docker/container-config.js";
import type { ResourceCaps } from "../spec/index.js";
import { terminateJob, type TerminationReason } from "../docker/termination.js";
import type { FacilitatorClient } from "../payments/facilitator-client.js";
import { decidePayment } from "../payments/payment-gate.js";
import type { ReceiptSink } from "../receipts/receipt-sink.js";
import { buildBlockReceipt } from "../receipts/receipt-builder.js";
import type { Logger } from "../logging.js";
import { snapshotOf, type JobEventBus } from "../events/job-events.js";

export interface CreateJobInput {
  renterUaid: string;
  image: string;
  cmd?: string[] | undefined;
  env?: Record<string, string> | undefined;
  blockSeconds: number;
  leadSeconds: number;
  pricePerBlock: string;
  asset: string;
}

export interface JobServiceConfig {
  dataDir: string;
  graceMs: number;
  /** Overrides for the container hardening defaults. */
  resourceCaps?: Partial<ResourceCaps> | undefined;
  providerUaid: string;
  network: string;
  payTo: string;
  facilitatorUrl: string;
}

export type HttpResult<T> = { status: number; body: T };

export class JobService {
  private readonly receiptsByJob = new Map<string, Map<number, BlockReceipt>>();

  constructor(
    private readonly registry: JobRegistry,
    private readonly docker: DockerRunner,
    private readonly facilitator: FacilitatorClient,
    private readonly receiptSink: ReceiptSink,
    private readonly clock: Clock,
    private readonly config: JobServiceConfig,
    private readonly logger: Logger,
    private readonly jobStore?: JobStore,
    private readonly events?: JobEventBus,
  ) {}

  createJob(
    input: CreateJobInput,
  ): HttpResult<PaymentRequirement | { error: string }> {
    const validation = validateLeadTime(input.blockSeconds, input.leadSeconds);
    if (!validation.ok) {
      return { status: 400, body: { error: validation.reason } };
    }

    const job: Job = {
      id: `j_${randomUUID()}`,
      renterUaid: input.renterUaid,
      image: input.image,
      cmd: input.cmd,
      env: input.env,
      blockSeconds: input.blockSeconds,
      leadSeconds: input.leadSeconds,
      pricePerBlock: input.pricePerBlock,
      asset: input.asset,
      blockIndex: 0,
      paidThrough: 0,
      status: "awaiting_payment",
      createdAt: this.clock.now(),
    };
    this.registry.add(job);
    void this.jobStore?.save(job);
    this.logger.info({ jobId: job.id }, "job created, awaiting block 1 payment");

    return { status: 402, body: this.buildPaymentRequirement(job, 1) };
  }

  async submitPayment(
    jobId: string,
    blockIndex: number,
    paymentProof: unknown,
  ): Promise<HttpResult<BlockReceipt | PaymentRequirement | ErrorBody | { error: string }>> {
    const job = this.registry.get(jobId);
    if (!job) return { status: 404, body: { error: "job_not_found" } };

    const now = this.clock.now();
    const existingReceipt = this.receiptsByJob.get(jobId)?.get(blockIndex);
    const decision = decidePayment(job, blockIndex, now, existingReceipt);

    if (decision.kind === "job_closed") return { status: 410, body: decision.body };
    if (decision.kind === "idempotent_replay") return { status: 200, body: decision.receipt };
    if (decision.kind === "window_closed") return { status: 425, body: decision.body };
    if (decision.kind === "out_of_order") return { status: 409, body: decision.body };

    // decision.kind === "verify"
    const requirement = this.buildPaymentRequirement(job, blockIndex);
    const result = await this.facilitator.verifyPayment({
      jobId,
      blockIndex,
      paymentProof,
      requirement,
    });
    if (!result.ok) {
      this.logger.warn({ jobId, blockIndex, error: result.error }, "payment verification failed");
      return { status: 402, body: requirement };
    }

    job.paidThrough = blockIndex;

    if (blockIndex === 1 && job.status === "awaiting_payment") {
      await this.startContainer(job);
    }

    const receipt = buildBlockReceipt(job, blockIndex, result.txId, this.config.providerUaid);
    this.storeReceipt(jobId, blockIndex, receipt);
    await this.receiptSink.record(receipt);
    void this.jobStore?.save(job);
    this.logger.info({ jobId, blockIndex, txId: result.txId }, "block settled");
    this.events?.publish({ type: "block", jobId, blockIndex, receipt });

    return { status: 200, body: receipt };
  }

  getBlockResource(
    jobId: string,
    blockIndex: number,
  ): HttpResult<PaymentRequirement | BlockReceipt | ErrorBody | { error: string }> {
    const job = this.registry.get(jobId);
    if (!job) return { status: 404, body: { error: "job_not_found" } };

    const now = this.clock.now();
    const existingReceipt = this.receiptsByJob.get(jobId)?.get(blockIndex);
    const decision = decidePayment(job, blockIndex, now, existingReceipt);

    if (decision.kind === "job_closed") return { status: 410, body: decision.body };
    if (decision.kind === "idempotent_replay") return { status: 200, body: decision.receipt };
    if (decision.kind === "window_closed") return { status: 425, body: decision.body };
    if (decision.kind === "out_of_order") return { status: 409, body: decision.body };

    return { status: 402, body: this.buildPaymentRequirement(job, blockIndex) };
  }

  getJob(jobId: string): Job | undefined {
    return this.registry.get(jobId);
  }

  /** Called by the Scheduler when a job's next block is already settled. */
  handleAdvance(job: Job, next: { nextBlockIndex: number; nextBoundaryAt: number }): void {
    job.blockIndex = next.nextBlockIndex;
    job.boundaryAt = next.nextBoundaryAt;
    void this.jobStore?.save(job);
    this.events?.publish({
      type: "advanced",
      jobId: job.id,
      blockIndex: job.blockIndex,
      boundaryAt: new Date(next.nextBoundaryAt).toISOString(),
    });
  }

  /** Called by the Scheduler when a job's boundary passes unpaid. */
  async handleTerminate(job: Job, reason: TerminationReason): Promise<void> {
    const receipt = await terminateJob(job, reason, {
      docker: this.docker,
      receiptSink: this.receiptSink,
      graceMs: this.config.graceMs,
      providerUaid: this.config.providerUaid,
    });
    void this.jobStore?.save(job);
    this.events?.publish({
      type: "terminated",
      jobId: job.id,
      reason,
      finalBlockIndex: job.blockIndex,
      receipt,
    });
  }

  /**
   * SPEC §5.3 — publish the renewal challenge for `blockIndex` on the event
   * stream. The same requirement is served by the 402 on the block resource,
   * so a renter that ignores the stream still renews correctly.
   */
  announceRenewal(job: Job, blockIndex: number): void {
    if (!this.events) return;
    const requirement = this.buildPaymentRequirement(job, blockIndex);
    const boundaryAt = job.boundaryAt ?? this.clock.now();
    this.events.publish({
      type: "renewal",
      jobId: job.id,
      blockIndex,
      windowOpensAt: requirement.blockMeta.windowOpensAt,
      boundaryAt: requirement.blockMeta.boundaryAt,
      msLeft: Math.max(0, boundaryAt - this.clock.now()),
      requirement,
    });
  }

  /** The `state` event every SSE connection opens with. */
  snapshot(jobId: string): ReturnType<typeof snapshotOf> | undefined {
    const job = this.registry.get(jobId);
    return job ? snapshotOf(job) : undefined;
  }

  /**
   * SPEC §5.5 — artifacts from paid blocks, delivered even when the job ended
   * `expired`. The renter paid for that work.
   */
  getArtifacts(
    jobId: string,
  ): HttpResult<{ jobId: string; status: string; artifacts: Job["artifacts"] } | { error: string }> {
    const job = this.registry.get(jobId);
    if (!job) return { status: 404, body: { error: "job_not_found" } };
    if (!job.artifacts) {
      return { status: 409, body: { error: "artifacts_not_ready" } };
    }
    return {
      status: 200,
      body: { jobId: job.id, status: job.status, artifacts: job.artifacts },
    };
  }

  private async startContainer(job: Job): Promise<void> {
    job.status = "starting";
    const artifactHostDir = join(this.config.dataDir, "artifacts", job.id);
    await mkdir(artifactHostDir, { recursive: true });

    const started = await this.docker.createAndStart({
      jobId: job.id,
      image: job.image,
      cmd: job.cmd,
      env: job.env,
      caps: { ...DEFAULT_RESOURCE_CAPS, ...this.config.resourceCaps },
      artifactHostDir,
    });

    job.containerId = started.containerId;
    // SPEC.md §5.2: the clock starts when the service is ready, not at payment.
    job.startedAt = started.readyAt;
    job.blockIndex = 1;
    job.boundaryAt = started.readyAt + job.blockSeconds * 1000;
    job.status = "running";
    void this.jobStore?.save(job);
    this.logger.info(
      { jobId: job.id, containerId: job.containerId, boundaryAt: job.boundaryAt },
      "clock started: container ready",
    );
  }

  private buildPaymentRequirement(job: Job, blockIndex: number): PaymentRequirement {
    // Block 1 has no renewal window (it's the initial payment, gates
    // container start); its blockMeta timestamps are a provisional
    // projection since the real clock starts only once the container is ready.
    const boundaryAt =
      job.boundaryAt ?? this.clock.now() + job.blockSeconds * 1000;
    const windowOpens = windowOpensAt(boundaryAt, job.leadSeconds);

    return {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: this.config.network,
          asset: job.asset,
          payTo: this.config.payTo,
          maxAmountRequired: job.pricePerBlock,
          resource: `/jobs/${job.id}/blocks/${blockIndex}`,
          description: `Block ${blockIndex} of ${job.blockSeconds}s on ${this.config.providerUaid}`,
          facilitator: this.config.facilitatorUrl,
        },
      ],
      blockMeta: {
        protocol: "bsp/0.1",
        jobId: job.id,
        blockIndex,
        blockSeconds: job.blockSeconds,
        leadSeconds: job.leadSeconds,
        clockStartedAt: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
        windowOpensAt: new Date(windowOpens).toISOString(),
        boundaryAt: new Date(boundaryAt).toISOString(),
      },
    };
  }

  private storeReceipt(jobId: string, blockIndex: number, receipt: BlockReceipt): void {
    if (!this.receiptsByJob.has(jobId)) this.receiptsByJob.set(jobId, new Map());
    this.receiptsByJob.get(jobId)!.set(blockIndex, receipt);
  }
}
