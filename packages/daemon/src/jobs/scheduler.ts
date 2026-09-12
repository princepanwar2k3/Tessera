import { evaluateBoundary, windowOpensAt, type Job } from "../spec/index.js";
import type { JobRegistry } from "./job-registry.js";
import type { Clock } from "./clock.js";
import type { Logger } from "../logging.js";

export type AdvanceHandler = (
  job: Job,
  next: { nextBlockIndex: number; nextBoundaryAt: number },
) => void;
export type TerminateHandler = (job: Job, reason: "unpaid_boundary") => Promise<void>;
/** SPEC §5.3 — the renewal window for block `blockIndex` has opened. */
export type WindowOpenHandler = (job: Job, blockIndex: number) => void;

/**
 * THE WATCHDOG. Ticks ~once/sec over every active job and evaluates the
 * boundary condition from src/spec/boundary.ts. This is the single most
 * demo-critical piece of the daemon (PLAN.md is explicit about this) — keep
 * it simple, and keep it exhaustively tested (see test/jobs/scheduler.test.ts).
 *
 * One global ticker rather than one setInterval per job: simpler to reason
 * about drift, and trivial to drive deterministically in tests via FakeClock.
 */
export class Scheduler {
  private handle: unknown;
  private readonly pending = new Set<Promise<void>>();
  /** `${jobId}:${blockIndex}` of windows already announced, so §5.3 fires once. */
  private readonly announced = new Set<string>();

  constructor(
    private readonly registry: JobRegistry,
    private readonly clock: Clock,
    private readonly onAdvance: AdvanceHandler,
    private readonly onTerminate: TerminateHandler,
    private readonly logger: Logger,
    private readonly intervalMs = 1000,
    private readonly onWindowOpen?: WindowOpenHandler,
  ) {}

  start(): void {
    this.handle = this.clock.setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.handle !== undefined) {
      this.clock.clearInterval(this.handle);
      this.handle = undefined;
    }
  }

  private tick(): void {
    const now = this.clock.now();
    for (const job of this.registry.listActive()) {
      // Announce the renewal window *before* evaluating the boundary: at the
      // tick where a window opens the boundary has not arrived yet, and a job
      // whose boundary fires this same tick is already past renewing.
      this.maybeOpenWindow(job, now);

      const result = evaluateBoundary(job, now);
      if (result.action === "advance") {
        this.logger.info(
          { jobId: job.id, nextBlockIndex: result.nextBlockIndex },
          "block boundary: advancing (renewal already settled)",
        );
        this.onAdvance(job, {
          nextBlockIndex: result.nextBlockIndex,
          nextBoundaryAt: result.nextBoundaryAt,
        });
      } else if (result.action === "terminate") {
        this.logger.warn(
          { jobId: job.id, blockIndex: job.blockIndex },
          "block boundary: unpaid — terminating",
        );
        const work = this.onTerminate(job, result.reason);
        this.pending.add(work);
        void work.finally(() => this.pending.delete(work));
      }
    }
  }

  /**
   * SPEC §5.3: at `boundaryAt - leadSeconds` the provider MUST make a payment
   * requirement available for the next block. Fires once per block, and only
   * while that block is still unpaid — a renter who prepaid needs no challenge.
   */
  private maybeOpenWindow(job: Job, now: number): void {
    if (!this.onWindowOpen || job.boundaryAt === undefined || job.status !== "running") return;

    const nextBlockIndex = job.blockIndex + 1;
    if (job.paidThrough >= nextBlockIndex) return;
    if (now < windowOpensAt(job.boundaryAt, job.leadSeconds)) return;

    const key = `${job.id}:${nextBlockIndex}`;
    if (this.announced.has(key)) return;
    this.announced.add(key);

    this.logger.info(
      { jobId: job.id, blockIndex: nextBlockIndex, boundaryAt: job.boundaryAt },
      "renewal window open",
    );
    this.onWindowOpen(job, nextBlockIndex);
  }

  /**
   * Test/shutdown helper: resolves once every termination triggered by ticks
   * so far has fully settled (SIGTERM/grace/SIGKILL/flush/receipt). Real
   * callers don't need this — the watchdog fires terminations independently
   * of anything waiting on them — but deterministic tests do.
   */
  async waitForIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all(this.pending);
    }
  }
}
