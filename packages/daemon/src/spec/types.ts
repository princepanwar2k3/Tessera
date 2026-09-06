/**
 * Local mirror of BSP v0.1 (SPEC.md) concepts.
 * Only this directory may define these types today; everything else in the
 * daemon imports them through ./index.ts. When packages/protocol and
 * packages/core exist, this file is replaced by re-exports from them.
 */

export type JobStatus =
  | "awaiting_payment"
  | "starting"
  | "running"
  | "closing"
  | "closed"
  | "expired"
  | "aborted";

export interface Job {
  id: string;
  renterUaid: string;
  image: string;
  cmd?: string[];
  env?: Record<string, string>;
  blockSeconds: number;
  leadSeconds: number;
  pricePerBlock: string; // smallest unit, decimal string to avoid float/bigint JSON issues
  asset: string;
  blockIndex: number; // block currently running (0 before block 1 starts)
  paidThrough: number; // highest settled block index
  containerId?: string;
  startedAt?: number; // ms epoch; clock starts here (container ready), not at payment
  boundaryAt?: number; // ms epoch of the current block's end
  status: JobStatus;
  artifacts?: JobArtifacts;
  createdAt: number;
}

export interface JobArtifacts {
  stdout: string;
  stderr: string;
  artifactDir?: string;
}

export interface BlockMeta {
  protocol: "bsp/0.1";
  jobId: string;
  blockIndex: number;
  blockSeconds: number;
  leadSeconds: number;
  clockStartedAt?: string; // RFC3339, present once block 1 has started
  windowOpensAt: string; // RFC3339
  boundaryAt: string; // RFC3339
}

export interface PaymentRequirement {
  x402Version: 1;
  accepts: [
    {
      scheme: "exact";
      network: string;
      asset: string;
      payTo: string;
      maxAmountRequired: string;
      resource: string;
      description: string;
      facilitator: string;
    },
  ];
  blockMeta: BlockMeta;
}

export type ReceiptType = "block_receipt" | "terminated" | "aborted";

export interface BlockReceipt {
  v: 1;
  protocol: "bsp/0.1";
  type: "block_receipt";
  jobId: string;
  blockIndex: number;
  providerUaid: string;
  renterUaid: string;
  asset: string;
  amount: string;
  txId: string;
  clockStartedAt: string;
  boundaryAt: string;
}

export interface TerminalReceipt {
  v: 1;
  protocol: "bsp/0.1";
  type: "terminated" | "aborted";
  jobId: string;
  reason: string;
  finalBlockIndex: number;
  providerUaid: string;
  renterUaid: string;
}

export type Receipt = BlockReceipt | TerminalReceipt;

export interface ErrorBody {
  error: "out_of_order" | "job_closed" | "window_closed";
  expectedBlockIndex?: number;
  finalBlockIndex?: number;
  reason?: string;
  windowOpensAt?: string;
}

export interface ResourceCaps {
  memoryBytes: number;
  cpus: number;
  pidsLimit?: number;
  networkMode?: string;
}
