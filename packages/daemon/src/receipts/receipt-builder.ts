import type { BlockReceipt, Job, TerminalReceipt } from "../spec/index.js";

export function buildBlockReceipt(
  job: Job,
  blockIndex: number,
  txId: string,
  providerUaid: string,
): BlockReceipt {
  if (job.startedAt === undefined) {
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
    // The boundary that ends *this* block, derived from the clock rather than
    // read off the job.
    //
    // job.boundaryAt is the end of the block currently being served (SPEC
    // §5.4), and a renewal is paid one block ahead of that — so using it
    // stamped block n's receipt with block n-1's boundary, and made block 1
    // and block 2 claim the same one. Two receipts asserting one boundary is
    // ambiguous evidence, and SPEC §8 leans on receipts being unambiguous.
    boundaryAt: new Date(job.startedAt + blockIndex * job.blockSeconds * 1000).toISOString(),
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
