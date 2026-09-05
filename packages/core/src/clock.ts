/**
 * BlockClock reducer — SPEC §5 lifecycle + §7 behaviours.
 *
 * Pure: no timers, no I/O, no network. The daemon wraps it in a ticker;
 * tests drive `now` (epoch millis) directly.
 *
 * Invariants enforced structurally:
 *  I1 — never enters `running` with paidThrough < blockIndex.
 *  I3 — `terminate` is never emitted while now < boundaryAt.
 */

export type JobStatus =
  | 'awaiting_payment'
  | 'starting'
  | 'running'
  | 'closing'
  | 'expired'
  | 'completed'
  | 'aborted';

export interface JobState {
  status: JobStatus;
  /** Block currently being served (1-based). Before start: 1. */
  blockIndex: number;
  /** Highest settled block index. 0 = nothing paid. */
  paidThrough: number;
  blockSeconds: number;
  leadSeconds: number;
  clockStartedAt?: number | undefined;
  boundaryAt?: number | undefined;
  /** Next-block index for which open_window was already emitted. */
  windowAnnouncedFor?: number | undefined;
  terminatedAt?: number | undefined;
  terminateReason?: string | undefined;
  finalBlockIndex?: number | undefined;
}

export type JobEvent =
  | { t: 'payment_settled'; blockIndex: number }
  | { t: 'service_ready' }
  | { t: 'service_exited' }
  | { t: 'provider_failed'; reason?: string }
  | { t: 'tick' };

export type JobEffect =
  | { t: 'open_window'; blockIndex: number }
  | { t: 'advance'; blockIndex: number; boundaryAt: number }
  | { t: 'terminate'; reason: string; finalBlockIndex: number }
  // Daemon obligation: key receipt handling on (jobId, blockIndex).
  // A duplicate settlement re-emits this effect for an already-settled
  // block — the daemon MUST return the existing receipt (SPEC §6.3 200)
  // and MUST NOT publish a second receipt.
  | { t: 'emit_receipt'; blockIndex: number };

export interface JobConfig {
  blockSeconds: number;
  leadSeconds: number;
}

const TERMINAL: ReadonlySet<JobStatus> = new Set(['expired', 'completed', 'aborted']);

export function isTerminal(s: JobState): boolean {
  return TERMINAL.has(s.status);
}

export function createJob(cfg: JobConfig): JobState {
  return {
    status: 'awaiting_payment',
    blockIndex: 1,
    paidThrough: 0,
    blockSeconds: cfg.blockSeconds,
    leadSeconds: cfg.leadSeconds,
  };
}

export function windowOpensAt(s: JobState): number | undefined {
  if (s.boundaryAt === undefined) return undefined;
  return s.boundaryAt - s.leadSeconds * 1000;
}

export function reduce(state: JobState, event: JobEvent, now: number): [JobState, JobEffect[]] {
  // Terminal states are absorbing: no event revives the job.
  // A payment settling after termination is rejected at the gate (410)
  // and never reaches here as an accepted settlement.
  if (isTerminal(state)) return [state, []];

  switch (event.t) {
    case 'payment_settled': {
      const n = event.blockIndex;
      // Idempotent duplicate: no state change, re-emit existing receipt.
      if (n <= state.paidThrough) {
        return [state, [{ t: 'emit_receipt', blockIndex: n }]];
      }
      // Out-of-order: gate rejects 409; reducer holds the line anyway.
      if (n !== state.paidThrough + 1) {
        return [state, []];
      }
      const next: JobState = { ...state, paidThrough: n };
      if (state.status === 'awaiting_payment') {
        // Only block 1 can be "next" here (paidThrough was 0).
        next.status = 'starting';
        return [next, [{ t: 'emit_receipt', blockIndex: n }]];
      }
      if (state.status === 'starting') {
        // Prepayment while provisioning: track paid_through, clock still
        // starts at service_ready (§5.2).
        return [next, [{ t: 'emit_receipt', blockIndex: n }]];
      }
      // running | closing: renewal paid inside (or outside) the window.
      // Window enforcement lives in getPaymentDecision; the reducer tracks
      // paid_through so a late-but-before-boundary payment still counts.
      return [next, [{ t: 'emit_receipt', blockIndex: n }]];
    }

    case 'service_ready': {
      // Clock starts when the service is ready to consume, not when
      // payment confirms (§5.2). Provisioning time is provider-borne,
      // so block 1 is always a full blockSeconds.
      if (state.status !== 'starting') return [state, []];
      // I1: never serve an unpaid block.
      if (state.paidThrough < 1) return [state, []];
      const boundaryAt = now + state.blockSeconds * 1000;
      const next: JobState = {
        ...state,
        status: 'running',
        clockStartedAt: now,
        boundaryAt,
        windowAnnouncedFor: undefined,
      };
      return [next, []];
    }

    case 'service_exited': {
      // Early completion: remainder of the block is forfeited (§5.6).
      if (state.status === 'running' || state.status === 'closing' || state.status === 'starting') {
        const finalBlockIndex = state.status === 'starting' ? 0 : state.blockIndex;
        const next: JobState = {
          ...state,
          status: 'completed',
          terminatedAt: now,
          terminateReason: 'completed',
          finalBlockIndex,
        };
        return [next, [{ t: 'terminate', reason: 'completed', finalBlockIndex }]];
      }
      return [state, []];
    }

    case 'provider_failed': {
      if (state.status === 'running' || state.status === 'closing' || state.status === 'starting') {
        const finalBlockIndex = state.status === 'starting' ? 0 : state.blockIndex;
        const reason = event.reason ?? 'provider_failed';
        const next: JobState = {
          ...state,
          status: 'aborted',
          terminatedAt: now,
          terminateReason: reason,
          finalBlockIndex,
        };
        return [next, [{ t: 'terminate', reason, finalBlockIndex }]];
      }
      return [state, []];
    }

    case 'tick': {
      if (state.status !== 'running' && state.status !== 'closing') {
        return [state, []];
      }
      const boundaryAt = state.boundaryAt;
      if (boundaryAt === undefined) return [state, []];
      if (now < boundaryAt) {
        // I3: MUST NOT terminate before boundaryAt, even with the window
        // closed and unpaid — a payment may still confirm.
        const openAt = boundaryAt - state.leadSeconds * 1000;
        if (
          now >= openAt &&
          state.paidThrough === state.blockIndex &&
          state.windowAnnouncedFor !== state.blockIndex + 1
        ) {
          const next: JobState = { ...state, windowAnnouncedFor: state.blockIndex + 1 };
          return [next, [{ t: 'open_window', blockIndex: state.blockIndex + 1 }]];
        }
        return [state, []];
      }
      // now >= boundaryAt: evaluate the boundary condition exactly once.
      if (state.paidThrough > state.blockIndex) {
        const blockIndex = state.blockIndex + 1;
        const nextBoundary = boundaryAt + state.blockSeconds * 1000;
        const next: JobState = {
          ...state,
          status: 'running',
          blockIndex,
          boundaryAt: nextBoundary,
          windowAnnouncedFor: undefined,
        };
        return [next, [{ t: 'advance', blockIndex, boundaryAt: nextBoundary }]];
      }
      const next: JobState = {
        ...state,
        status: 'expired',
        terminatedAt: now,
        terminateReason: 'unpaid_boundary',
        finalBlockIndex: state.blockIndex,
      };
      return [
        next,
        [{ t: 'terminate', reason: 'unpaid_boundary', finalBlockIndex: state.blockIndex }],
      ];
    }
  }
}

// --- Payment gate decisions — SPEC §6.3 / §7 ---

export type PaymentDecision =
  | { ok: true; duplicate: boolean }
  | { ok: false; http: 409 | 410 | 425; code: 'out_of_order' | 'job_closed' | 'window_closed'; expectedBlockIndex?: number; windowOpensAt?: number; finalBlockIndex?: number; reason?: string };

/**
 * Decide whether a settlement for `requestedBlock` may be accepted at `now`.
 * The daemon calls this BEFORE settling: rejects map to §6.3 error codes,
 * accepts flow into `reduce(state, {t:'payment_settled'...})`.
 */
export function getPaymentDecision(
  state: JobState,
  requestedBlock: number,
  now: number,
): PaymentDecision {
  if (isTerminal(state)) {
    return {
      ok: false,
      http: 410,
      code: 'job_closed',
      finalBlockIndex: state.finalBlockIndex ?? state.blockIndex,
      reason: state.terminateReason ?? state.status,
    };
  }
  if (requestedBlock <= state.paidThrough) {
    // Duplicate for a settled block: idempotent 200 with existing receipt.
    return { ok: true, duplicate: true };
  }
  if (requestedBlock !== state.paidThrough + 1) {
    return { ok: false, http: 409, code: 'out_of_order', expectedBlockIndex: state.paidThrough + 1 };
  }
  if (state.status === 'awaiting_payment' || state.status === 'starting') {
    // Block 1 (and prepayment while provisioning): no window applies.
    return { ok: true, duplicate: false };
  }
  // running | closing: renewal window applies (SHOULD reject 425 early;
  // we reject — the MAY-accept prepayment path is intentionally not taken
  // so `paid_through` can never run ahead of the window).
  const boundaryAt = state.boundaryAt;
  if (boundaryAt === undefined) return { ok: true, duplicate: false };
  const openAt = boundaryAt - state.leadSeconds * 1000;
  if (now < openAt) {
    return { ok: false, http: 425, code: 'window_closed', windowOpensAt: openAt };
  }
  return { ok: true, duplicate: false };
}
