import type { BlockReceipt, PaymentRequirement, TerminalReceipt } from "@bsp/protocol";
import type { JobEvent, JobSnapshot, SequencedJobEvent } from "./events.js";
import { JobEventStream } from "./stream.js";
import { decideRenewal, blocksAffordable, type RenewalDecision } from "./renewal-policy.js";
import { addAmounts } from "./amounts.js";
import type { Payer } from "./payer.js";

type FetchLike = typeof globalThis.fetch;

export interface JobHandlers {
  block: (info: { index: number; txId: string; receipt: BlockReceipt }) => void;
  renewal: (info: { index: number; msLeft: number; willPay: boolean; reason?: string }) => void;
  advanced: (info: { index: number; boundaryAt: string }) => void;
  terminated: (info: {
    reason: string;
    finalBlockIndex: number;
    receipt?: TerminalReceipt | undefined;
  }) => void;
  error: (err: Error) => void;
}

export interface JobOptions {
  jobId: string;
  /** The daemon's own base URL. The renter pays here, directly. */
  endpoint: string;
  budget: string;
  maxBlocks?: number | undefined;
  pricePerBlock: string;
  blockSeconds: number;
  leadSeconds: number;
  payer: Payer;
  fetchImpl?: FetchLike;
  /** Poll interval for the timer fallback. */
  fallbackIntervalMs?: number;
  now?: () => number;
}

export interface JobResult {
  jobId: string;
  reason: string;
  finalBlockIndex: number;
  blocksPaid: number;
  spent: string;
  receipts: BlockReceipt[];
  terminalReceipt?: TerminalReceipt | undefined;
  artifacts?: unknown;
}

/**
 * A running job, from the renter's side.
 *
 * Two things drive renewal: the SSE `renewal` event, and a timer computed from
 * the clock the daemon published. Either alone is sufficient. That redundancy
 * is the point — PLAN.md requires that a dropped stream can never kill a paid
 * job, so the stream is never the only thing watching the clock.
 */
export class Job {
  private readonly handlers: { [K in keyof JobHandlers]: JobHandlers[K][] } = {
    block: [],
    renewal: [],
    advanced: [],
    terminated: [],
    error: [],
  };

  private stream?: JobEventStream;
  private fallbackTimer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private finished = false;
  private snapshot?: JobSnapshot;

  private blocksPaid = 0;
  private spent = "0";
  private readonly receipts: BlockReceipt[] = [];
  private terminalReceipt?: TerminalReceipt;
  /** Blocks with a payment in flight or settled, so nothing is paid twice. */
  private readonly attempted = new Set<number>();
  /**
   * Blocks a `renewal` decision has already been reported for. The stream and
   * the timer fallback both reach `considerRenewal`, and the fallback ticks
   * several times a second, so without this a declined block reports once per
   * tick — which spams the renter's log and the console ticker alike.
   */
  private readonly announced = new Set<number>();

  private resolveResult!: (r: JobResult) => void;
  private readonly completion = new Promise<JobResult>((resolve) => {
    this.resolveResult = resolve;
  });

  constructor(private readonly opts: JobOptions) {}

  get id(): string {
    return this.opts.jobId;
  }

  get state(): JobSnapshot | undefined {
    return this.snapshot;
  }

  /**
   * Where the workload is reachable, while the job is paid for. Undefined for
   * batch work, and for a job that has stopped — the whole point being that
   * it goes away at the boundary.
   */
  get serviceUrl(): string | undefined {
    return this.finished ? undefined : this.snapshot?.serviceUrl;
  }

  get totalSpent(): string {
    return this.spent;
  }

  get settledBlocks(): number {
    return this.blocksPaid;
  }

  /** Blocks the remaining budget still affords. */
  get blocksRemaining(): number {
    return blocksAffordable({
      spent: this.spent,
      budget: this.opts.budget,
      blocksPaid: this.blocksPaid,
      maxBlocks: this.opts.maxBlocks,
      pricePerBlock: this.opts.pricePerBlock,
    });
  }

  on<K extends keyof JobHandlers>(event: K, handler: JobHandlers[K]): this {
    this.handlers[event].push(handler);
    return this;
  }

  /**
   * The kill switch. Not a message to the provider — the renter simply stops
   * buying, and the job ends at the next boundary (SPEC §5.4, §7).
   */
  stopRenewing(): void {
    this.stopped = true;
  }

  /** Record block 1, settled during `rent()` before the handle existed. */
  noteInitialSettlement(receipt: BlockReceipt): void {
    this.attempted.add(receipt.blockIndex);
    this.recordReceipt(receipt);
  }

  start(): void {
    const url = `${this.base}/jobs/${this.opts.jobId}/events`;
    this.stream = new JobEventStream(url, (event) => this.handleEvent(event), {
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      onError: (err) => this.emit("error", err),
    });
    this.stream.start();

    // Runs whether or not the stream is healthy. This is what makes the
    // stream a hint rather than a dependency.
    const interval = this.opts.fallbackIntervalMs ?? 500;
    this.fallbackTimer = setInterval(() => void this.checkWindowByClock(), interval);
    this.fallbackTimer.unref?.();
  }

  async result(): Promise<JobResult> {
    return this.completion;
  }

  private get base(): string {
    return this.opts.endpoint.replace(/\/$/, "");
  }

  private get fetchImpl(): FetchLike {
    return this.opts.fetchImpl ?? globalThis.fetch;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private handleEvent(event: SequencedJobEvent): void {
    switch (event.type) {
      case "state":
        this.snapshot = event.job;
        break;
      case "renewal":
        if (this.snapshot) this.snapshot = { ...this.snapshot, boundaryAt: event.boundaryAt };
        void this.considerRenewal(event.blockIndex, event.msLeft);
        break;
      case "block":
        this.recordReceipt(event.receipt);
        break;
      case "advanced":
        if (this.snapshot) {
          this.snapshot = {
            ...this.snapshot,
            blockIndex: event.blockIndex,
            boundaryAt: event.boundaryAt,
          };
        }
        this.emit("advanced", { index: event.blockIndex, boundaryAt: event.boundaryAt });
        break;
      case "terminated":
        this.terminalReceipt = event.receipt;
        void this.finish(event.reason, event.finalBlockIndex);
        break;
    }
  }

  /**
   * Timer fallback: derive the current window from the clock the daemon
   * published, with no stream involved at all.
   */
  private async checkWindowByClock(): Promise<void> {
    const snap = this.snapshot;
    if (this.finished || !snap?.boundaryAt) return;

    const boundaryAt = Date.parse(snap.boundaryAt);
    const windowOpensAt = boundaryAt - snap.leadSeconds * 1000;
    const now = this.now();
    if (now < windowOpensAt || now >= boundaryAt) return;

    await this.considerRenewal(snap.blockIndex + 1, boundaryAt - now);
  }

  private async considerRenewal(blockIndex: number, msLeft: number): Promise<void> {
    if (this.finished || this.attempted.has(blockIndex)) return;

    const decision: RenewalDecision = decideRenewal(
      {
        spent: this.spent,
        budget: this.opts.budget,
        blocksPaid: this.blocksPaid,
        maxBlocks: this.opts.maxBlocks,
        pricePerBlock: this.opts.pricePerBlock,
      },
      this.stopped,
    );

    if (!this.announced.has(blockIndex)) {
      this.announced.add(blockIndex);
      this.emit("renewal", {
        index: blockIndex,
        msLeft,
        willPay: decision.pay,
        ...(decision.pay ? {} : { reason: decision.reason }),
      });
    }

    // Declining is the whole of the kill switch: do nothing, and the
    // provider's watchdog ends the job at the boundary.
    if (!decision.pay) return;

    this.attempted.add(blockIndex);
    const settled = await this.payBlock(blockIndex, msLeft);
    if (!settled) {
      // Let a later window (or the fallback tick) retry this block.
      this.attempted.delete(blockIndex);
    }
  }

  /**
   * Pay one block, retrying with backoff for as long as the window is open.
   * A 10s window permits several attempts (SPEC §7, facilitator timeout).
   */
  private async payBlock(blockIndex: number, msLeft: number): Promise<boolean> {
    const deadline = this.now() + msLeft;
    let delay = 250;

    while (this.now() < deadline && !this.finished) {
      try {
        const challenge = await this.fetchImpl(
          `${this.base}/jobs/${this.opts.jobId}/blocks/${blockIndex}`,
        );

        if (challenge.status === 200) {
          // Already settled — idempotent replay returns the existing receipt.
          this.recordReceipt((await challenge.json()) as BlockReceipt);
          return true;
        }
        if (challenge.status === 410) return false; // job closed; nothing to buy
        if (challenge.status === 425) {
          // Window not open yet. Wait rather than burning the budget on 425s.
          await this.sleep(delay);
          continue;
        }
        if (challenge.status !== 402) throw new Error(`unexpected ${challenge.status}`);

        const requirement = (await challenge.json()) as PaymentRequirement & {
          paymentError?: string;
        };
        const proof = await this.opts.payer.pay({
          jobId: this.opts.jobId,
          blockIndex,
          requirement,
        });

        const res = await this.fetchImpl(
          `${this.base}/jobs/${this.opts.jobId}/blocks/${blockIndex}/payment`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(proof),
          },
        );

        if (res.status === 200) {
          this.recordReceipt((await res.json()) as BlockReceipt);
          return true;
        }
        if (res.status === 410) return false;
        if (res.status === 402) {
          // The provider refused the payment and said why. Surface it once
          // per attempt rather than retrying in silence until the boundary.
          const refused = (await res.json().catch(() => ({}))) as { paymentError?: string };
          if (refused.paymentError) {
            this.emit(
              "error",
              new Error(`block ${blockIndex} refused: ${refused.paymentError}`),
            );
          }
        }
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }

      await this.sleep(delay);
      delay = Math.min(delay * 2, 2000);
    }

    return false;
  }

  private recordReceipt(receipt: BlockReceipt): void {
    if (this.receipts.some((r) => r.blockIndex === receipt.blockIndex)) return;

    this.receipts.push(receipt);
    this.blocksPaid = this.receipts.length;
    this.spent = addAmounts(this.spent, receipt.amount);
    this.attempted.add(receipt.blockIndex);
    this.emit("block", { index: receipt.blockIndex, txId: receipt.txId, receipt });
  }

  private async finish(reason: string, finalBlockIndex: number): Promise<void> {
    if (this.finished) return;
    this.finished = true;

    this.stream?.close();
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);

    // SPEC §5.5: artifacts from paid blocks are delivered even on `expired`.
    let artifacts: unknown;
    try {
      const res = await this.fetchImpl(`${this.base}/jobs/${this.opts.jobId}/artifacts`);
      if (res.ok) artifacts = await res.json();
    } catch {
      // Artifacts are best-effort; the settlement record is what matters.
    }

    this.emit("terminated", { reason, finalBlockIndex, receipt: this.terminalReceipt });
    this.resolveResult({
      jobId: this.opts.jobId,
      reason,
      finalBlockIndex,
      blocksPaid: this.blocksPaid,
      spent: this.spent,
      receipts: [...this.receipts].sort((a, b) => a.blockIndex - b.blockIndex),
      terminalReceipt: this.terminalReceipt,
      artifacts,
    });
  }

  private emit<K extends keyof JobHandlers>(event: K, ...args: Parameters<JobHandlers[K]>): void {
    for (const handler of this.handlers[event]) {
      try {
        (handler as (...a: unknown[]) => void)(...args);
      } catch {
        // A renter's callback throwing must not derail the renewal loop.
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }
}
