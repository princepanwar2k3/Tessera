import type { Job, TerminalReceipt } from "../spec/index.js";
import type { DockerRunner } from "./docker-runner.js";
import type { ReceiptSink } from "../receipts/receipt-sink.js";
import { buildTerminalReceipt } from "../receipts/receipt-builder.js";

export type TerminationReason = "unpaid_boundary" | "completed" | "operator_stop";

export interface TerminationDeps {
  docker: DockerRunner;
  receiptSink: ReceiptSink;
  graceMs: number;
  providerUaid: string;
}

/**
 * SPEC.md §5.5 — on termination: signal to stop gracefully, allow a
 * non-billable grace period, force-stop if still running, flush artifacts
 * from paid blocks, emit a terminal receipt. Artifacts MUST be delivered
 * even on `expired` termination — the renter paid for that work.
 */
export async function terminateJob(
  job: Job,
  reason: TerminationReason,
  deps: TerminationDeps,
): Promise<TerminalReceipt> {
  job.status = "closing";

  if (job.containerId) {
    await deps.docker.kill(job.containerId, "SIGTERM");
    const exited = await deps.docker.waitForExit(job.containerId, deps.graceMs);
    if (!exited) {
      await deps.docker.kill(job.containerId, "SIGKILL");
      await deps.docker.waitForExit(job.containerId, deps.graceMs);
    }
    job.artifacts = await deps.docker.collectArtifacts(job.containerId);
  }

  job.status = reason === "unpaid_boundary" ? "expired" : "closed";

  const receiptType = reason === "unpaid_boundary" ? "terminated" : "terminated";
  const receipt = buildTerminalReceipt(job, reason, deps.providerUaid, receiptType);
  await deps.receiptSink.record(receipt);
  return receipt;
}

/** SPEC §7 — provider crash mid-block MUST emit an `aborted` receipt on recovery. */
export async function abortJob(
  job: Job,
  reason: string,
  deps: Pick<TerminationDeps, "receiptSink" | "providerUaid">,
): Promise<TerminalReceipt> {
  job.status = "aborted";
  const receipt = buildTerminalReceipt(job, reason, deps.providerUaid, "aborted");
  await deps.receiptSink.record(receipt);
  return receipt;
}
