import type { BlockReceipt, Job, PaymentRequirement, TerminalReceipt } from "../spec/index.js";

/**
 * The job event stream — SPEC §5.3's "renewal challenge on the job's event
 * stream", plus the settlement and termination events the console and SDK
 * render.
 *
 * PLAN.md fixes this shape at Gate 2 as the P2 -> P3 contract. The stream is
 * a *hint, never a dependency*: a renter that never connects can still pay by
 * polling the 402 on the block resource, and an SDK whose stream drops falls
 * back to a timer computed from `clockStartedAt`. Nothing here may become
 * load-bearing for settlement.
 */

export interface JobSnapshot {
  jobId: string;
  status: Job["status"];
  blockIndex: number;
  paidThrough: number;
  blockSeconds: number;
  leadSeconds: number;
  pricePerBlock: string;
  asset: string;
  clockStartedAt?: string | undefined;
  boundaryAt?: string | undefined;
}

export type JobEvent =
  /** Sent first on every connection so a late subscriber needs no other call. */
  | { type: "state"; jobId: string; job: JobSnapshot }
  /** SPEC §5.3: window open for block `blockIndex`. Carries the full 402 body. */
  | {
      type: "renewal";
      jobId: string;
      blockIndex: number;
      windowOpensAt: string;
      boundaryAt: string;
      msLeft: number;
      requirement: PaymentRequirement;
    }
  /** A block settled. */
  | { type: "block"; jobId: string; blockIndex: number; receipt: BlockReceipt }
  /** SPEC §5.4: boundary passed with the next block paid. */
  | { type: "advanced"; jobId: string; blockIndex: number; boundaryAt: string }
  /** Terminal. No further events for this job. */
  | {
      type: "terminated";
      jobId: string;
      reason: string;
      finalBlockIndex: number;
      receipt: TerminalReceipt;
    };

/** An event as delivered: the payload plus its stream position. */
export type SequencedJobEvent = JobEvent & { seq: number };

export type JobEventListener = (event: SequencedJobEvent) => void;

/** Per-job ring buffer depth. Enough to replay a whole demo job after a drop. */
const DEFAULT_BUFFER = 256;

/**
 * In-process pub/sub with a replay buffer per job.
 *
 * The buffer is what makes SSE reconnection honest: a client that reconnects
 * with `Last-Event-ID` gets exactly the events it missed, so a dropped stream
 * costs nothing. Bounded, because a long job on a busy node must not grow
 * memory without limit.
 */
export class JobEventBus {
  private seq = 0;
  private readonly buffers = new Map<string, SequencedJobEvent[]>();
  private readonly perJob = new Map<string, Set<JobEventListener>>();
  private readonly global = new Set<JobEventListener>();

  constructor(private readonly bufferSize = DEFAULT_BUFFER) {}

  publish(event: JobEvent): SequencedJobEvent {
    const sequenced = { ...event, seq: ++this.seq } as SequencedJobEvent;

    const buffer = this.buffers.get(event.jobId) ?? [];
    buffer.push(sequenced);
    if (buffer.length > this.bufferSize) buffer.shift();
    this.buffers.set(event.jobId, buffer);

    for (const listener of this.perJob.get(event.jobId) ?? []) safely(listener, sequenced);
    for (const listener of this.global) safely(listener, sequenced);

    return sequenced;
  }

  /** Subscribe to one job. Returns the unsubscribe function. */
  subscribe(jobId: string, listener: JobEventListener): () => void {
    const set = this.perJob.get(jobId) ?? new Set<JobEventListener>();
    set.add(listener);
    this.perJob.set(jobId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.perJob.delete(jobId);
    };
  }

  /** Subscribe to every job — the control plane's SSE mirror uses this. */
  subscribeAll(listener: JobEventListener): () => void {
    this.global.add(listener);
    return () => this.global.delete(listener);
  }

  /** Events buffered for a job after `afterSeq` (0 = everything retained). */
  replay(jobId: string, afterSeq = 0): SequencedJobEvent[] {
    return (this.buffers.get(jobId) ?? []).filter((e) => e.seq > afterSeq);
  }

  /** Drop a finished job's buffer. Terminal jobs are replayable until this runs. */
  forget(jobId: string): void {
    this.buffers.delete(jobId);
  }

  subscriberCount(jobId: string): number {
    return (this.perJob.get(jobId)?.size ?? 0) + this.global.size;
  }
}

/**
 * One listener throwing must not stop the others, and must never propagate
 * into the settlement path that published the event.
 */
function safely(listener: JobEventListener, event: SequencedJobEvent): void {
  try {
    listener(event);
  } catch {
    // A broken subscriber is the subscriber's problem.
  }
}

/** Snapshot for the `state` event and the control-plane mirror. */
export function snapshotOf(job: Job): JobSnapshot {
  return {
    jobId: job.id,
    status: job.status,
    blockIndex: job.blockIndex,
    paidThrough: job.paidThrough,
    blockSeconds: job.blockSeconds,
    leadSeconds: job.leadSeconds,
    pricePerBlock: job.pricePerBlock,
    asset: job.asset,
    clockStartedAt: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
    boundaryAt: job.boundaryAt ? new Date(job.boundaryAt).toISOString() : undefined,
  };
}
