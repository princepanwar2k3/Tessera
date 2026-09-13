/** Wire shapes from the daemon and control plane. Kept local: the console is
 *  a browser bundle and must not pull a Node package in for four interfaces. */

export interface MachineListing {
  machineId: string;
  providerId: string;
  endpoint: string;
  specs: { cpuCores: number; memoryMB: number; arch: string; gpu?: string };
  params: {
    blockSeconds: number;
    leadSeconds: number;
    pricePerBlock: string;
    asset: string;
  };
  benchmark: { name: string; score: number; ranAt: string; selfReported: boolean };
  live: boolean;
  lastSeenAt: string;
  /** Jobs the node reports it is currently serving. */
  activeJobs?: number;
}

export interface JobSnapshot {
  jobId: string;
  status: string;
  blockIndex: number;
  paidThrough: number;
  blockSeconds: number;
  leadSeconds: number;
  pricePerBlock: string;
  asset: string;
  clockStartedAt?: string | undefined;
  boundaryAt?: string | undefined;
  /** Live only while the job is paid for. */
  serviceUrl?: string | undefined;
}

export interface BlockReceipt {
  blockIndex: number;
  amount: string;
  asset: string;
  txId: string;
  providerUaid?: string;
  renterUaid?: string;
}

export interface TerminalReceipt {
  reason: string;
  finalBlockIndex: number;
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

export interface TickerLine {
  kind: "block" | "terminated";
  blockIndex: number;
  text: string;
  txId?: string;
  amount?: string;
}
