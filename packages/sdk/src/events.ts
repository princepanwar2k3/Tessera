/**
 * The daemon's event stream shapes — the Gate-2 P2 -> P3 contract.
 * Mirrored here so the SDK depends on the wire format, not on @bsp/daemon
 * (PLAN.md's dependency rule: nothing depends on daemon).
 */
import type { PaymentRequirement, BlockReceipt, TerminalReceipt } from "@bsp/protocol";

export interface JobSnapshot {
  jobId: string;
  status: string;
  blockIndex: number;
  paidThrough: number;
  blockSeconds: number;
  leadSeconds: number;
  pricePerBlock: string;
  asset: string;
  clockStartedAt?: string;
  boundaryAt?: string;
}

export type JobEvent =
  | { type: "state"; jobId: string; job: JobSnapshot }
  | {
      type: "renewal";
      jobId: string;
      blockIndex: number;
      windowOpensAt: string;
      boundaryAt: string;
      msLeft: number;
      requirement: PaymentRequirement;
    }
  | { type: "block"; jobId: string; blockIndex: number; receipt: BlockReceipt }
  | { type: "advanced"; jobId: string; blockIndex: number; boundaryAt: string }
  | {
      type: "terminated";
      jobId: string;
      reason: string;
      finalBlockIndex: number;
      receipt: TerminalReceipt;
    };

export type SequencedJobEvent = JobEvent & { seq: number };
