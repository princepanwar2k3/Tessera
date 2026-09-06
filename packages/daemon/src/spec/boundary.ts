import type { Job } from "./types.js";

export type BoundaryResult =
  | { action: "none" }
  | { action: "advance"; nextBlockIndex: number; nextBoundaryAt: number }
  | { action: "terminate"; reason: "unpaid_boundary" };

type BoundaryInput = Pick<Job, "blockIndex" | "paidThrough" | "boundaryAt" | "blockSeconds">;

/**
 * SPEC.md §5.4 — evaluated at or after boundaryAt, never before.
 *
 *   if now >= boundary_at:
 *     if paid_through > block_index:
 *       block_index  += 1
 *       boundary_at  += block_seconds
 *     else:
 *       terminate(reason = "unpaid_boundary")
 */
export function evaluateBoundary(job: BoundaryInput, now: number): BoundaryResult {
  if (job.boundaryAt === undefined || now < job.boundaryAt) {
    return { action: "none" };
  }
  if (job.paidThrough > job.blockIndex) {
    return {
      action: "advance",
      nextBlockIndex: job.blockIndex + 1,
      nextBoundaryAt: job.boundaryAt + job.blockSeconds * 1000,
    };
  }
  return { action: "terminate", reason: "unpaid_boundary" };
}

/** SPEC.md §5.3 — the final lead_seconds of the current block. */
export function windowOpensAt(boundaryAt: number, leadSeconds: number): number {
  return boundaryAt - leadSeconds * 1000;
}

export function isWindowOpen(boundaryAt: number, leadSeconds: number, now: number): boolean {
  return now >= windowOpensAt(boundaryAt, leadSeconds) && now < boundaryAt;
}
