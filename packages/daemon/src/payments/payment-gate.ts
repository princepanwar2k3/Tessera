import { isWindowOpen, windowOpensAt, type BlockReceipt, type ErrorBody, type Job } from "../spec/index.js";

export type PaymentDecision =
  | { kind: "job_closed"; body: ErrorBody }
  | { kind: "idempotent_replay"; receipt: BlockReceipt }
  | { kind: "window_closed"; body: ErrorBody }
  | { kind: "out_of_order"; body: ErrorBody }
  | { kind: "verify" };

const TERMINAL_STATUSES = new Set(["closed", "expired", "aborted"]);

/**
 * SPEC.md §6.3 / §7 payment decision table. Pure function: given the job's
 * current state, the block being paid for, and the current time, decide
 * what the payment route should do — without touching the facilitator,
 * Docker, or any I/O. This keeps the whole error-code matrix exhaustively
 * unit-testable.
 */
export function decidePayment(
  job: Job,
  blockIndex: number,
  now: number,
  existingReceipt?: BlockReceipt,
): PaymentDecision {
  if (TERMINAL_STATUSES.has(job.status)) {
    return {
      kind: "job_closed",
      body: { error: "job_closed", finalBlockIndex: job.blockIndex, reason: job.status },
    };
  }

  // Duplicate payment for an already-settled block: idempotent, no re-verify, no double-charge.
  if (blockIndex <= job.paidThrough) {
    if (existingReceipt) {
      return { kind: "idempotent_replay", receipt: existingReceipt };
    }
    // paidThrough says it's settled but we have no receipt on file (shouldn't
    // normally happen) — still don't re-verify or double-charge; treat as
    // out-of-order-safe by falling through to verify would double-charge, so
    // we refuse instead by reporting the expected next block.
    return {
      kind: "out_of_order",
      body: { error: "out_of_order", expectedBlockIndex: job.paidThrough + 1 },
    };
  }

  const expected = job.paidThrough + 1;
  if (blockIndex > expected) {
    return { kind: "out_of_order", body: { error: "out_of_order", expectedBlockIndex: expected } };
  }

  // blockIndex === expected. Block 1 (before the clock starts) has no window
  // gating; blocks after block 1 must be within their renewal window.
  const isRenewal = job.boundaryAt !== undefined && blockIndex > 1;
  if (isRenewal && !isWindowOpen(job.boundaryAt!, job.leadSeconds, now)) {
    if (now < windowOpensAt(job.boundaryAt!, job.leadSeconds)) {
      return {
        kind: "window_closed",
        body: {
          error: "window_closed",
          windowOpensAt: new Date(windowOpensAt(job.boundaryAt!, job.leadSeconds)).toISOString(),
        },
      };
    }
    // now >= boundaryAt: the boundary has already passed and the watchdog
    // should have (or will) terminate the job. Report job_closed rather than
    // silently accepting a late payment (SPEC §7: payment after boundary MUST be rejected).
    return {
      kind: "job_closed",
      body: { error: "job_closed", finalBlockIndex: job.blockIndex, reason: "unpaid_boundary" },
    };
  }

  return { kind: "verify" };
}
