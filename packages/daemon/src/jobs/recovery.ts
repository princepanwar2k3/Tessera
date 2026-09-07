import type { JobStore } from "./job-store.js";
import type { JobRegistry } from "./job-registry.js";
import type { ReceiptSink } from "../receipts/receipt-sink.js";
import { abortJob } from "../docker/termination.js";
import type { Logger } from "../logging.js";

/**
 * Boot-time scan: any job left in `starting`/`running` when the process
 * last stopped means the daemon crashed mid-block. This process has no
 * live container tracking to reconcile against on a fresh boot, so the
 * job is closed out with an `aborted` receipt rather than resumed
 * (SPEC.md §7). Jobs already in a terminal state are re-registered as-is
 * so status queries keep working across a restart.
 */
export async function recoverOrphanedJobs(
  store: JobStore,
  registry: JobRegistry,
  receiptSink: ReceiptSink,
  providerUaid: string,
  logger: Logger,
): Promise<void> {
  const jobs = await store.loadAll();
  for (const job of jobs) {
    if (job.status === "starting" || job.status === "running") {
      await abortJob(job, "provider_restart", { receiptSink, providerUaid });
      await store.save(job);
      logger.warn({ jobId: job.id }, "recovered orphaned job as aborted");
    }
    registry.add(job);
  }
}
