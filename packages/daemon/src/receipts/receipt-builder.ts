import type { BlockReceipt, Job, TerminalReceipt } from "../spec/index.js";

export function buildBlockReceipt(
  job: Job,
  blockIndex: number,
  txId: string,
  providerUaid: string,
): BlockReceipt {
  if (job.startedAt === undefined || job.boundaryAt === undefined) {
    throw new Error(`job ${job.id} has no clock started; cannot build a block receipt`);
  }
  return {
    v: 1,
    protocol: "bsp/0.1",
    type: "block_receipt",
    jobId: job.id,
    blockIndex,
    providerUaid,
    renterUaid: job.renterUaid,
    asset: job.asset,
    amount: job.pricePerBlock,
    txId,
    clockStartedAt: new Date(job.startedAt).toISOString(),
    boundaryAt: new Date(job.boundaryAt).toISOString(),
  };
}

export function buildTerminalReceipt(
  job: Job,
  reason: string,
  providerUaid: string,
  type: "terminated" | "aborted" = "terminated",
): TerminalReceipt {
  return {
    v: 1,
    protocol: "bsp/0.1",
    type,
    jobId: job.id,
    reason,
    finalBlockIndex: job.blockIndex,
    providerUaid,
    renterUaid: job.renterUaid,
  };
}
