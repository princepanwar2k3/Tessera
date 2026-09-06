/**
 * Standalone proof of the watchdog against a REAL container, no HTTP layer
 * involved. This is the PLAN.md Day-2 hard gate: prove that an unpaid block
 * boundary kills a real Docker container via SIGTERM -> grace -> SIGKILL and
 * emits a terminal receipt.
 *
 * Requires Docker to be running locally.
 * Run with: pnpm --filter @tessera/daemon demo:kill
 */
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../src/logging.js";
import { DockerodeRunner } from "../src/docker/dockerode-runner.js";
import { LocalFileReceiptSink } from "../src/receipts/receipt-sink.js";
import { terminateJob } from "../src/docker/termination.js";
import { DEFAULT_RESOURCE_CAPS } from "../src/docker/container-config.js";
import type { Job } from "../src/spec/index.js";

async function main() {
  const logger = createLogger("demo-kill");
  const dataDir = await mkdtemp(join(tmpdir(), "tessera-demo-kill-"));
  const docker = new DockerodeRunner(logger);
  const receiptSink = new LocalFileReceiptSink(dataDir);

  const blockSeconds = 10;
  const leadSeconds = 4;
  const jobId = `j_${randomUUID()}`;
  const artifactHostDir = join(dataDir, "artifacts", jobId);

  console.log(`\nStarting a real container for job ${jobId} (block=${blockSeconds}s, lead=${leadSeconds}s)...`);
  const started = await docker.createAndStart({
    jobId,
    image: "busybox:latest",
    cmd: ["sleep", "3600"],
    caps: DEFAULT_RESOURCE_CAPS,
    artifactHostDir,
  });
  console.log(`Container ${started.containerId} is running. Clock starts now (container ready, not at payment).`);

  const job: Job = {
    id: jobId,
    renterUaid: "uaid:demo:renter",
    image: "busybox:latest",
    cmd: ["sleep", "3600"],
    blockSeconds,
    leadSeconds,
    pricePerBlock: "1500",
    asset: "MOCK",
    blockIndex: 1,
    paidThrough: 1, // block 1 paid; block 2 will NEVER be paid
    status: "running",
    createdAt: Date.now(),
    startedAt: started.readyAt,
    boundaryAt: started.readyAt + blockSeconds * 1000,
    containerId: started.containerId,
  };

  console.log(
    `Block 1 boundary at ${new Date(job.boundaryAt!).toISOString()}. ` +
      `Renewal window opens ${leadSeconds}s before that. No renewal will be paid.`,
  );
  console.log("Waiting for the boundary...\n");

  await new Promise((resolve) => setTimeout(resolve, blockSeconds * 1000 + 500));

  console.log(`Boundary passed with paidThrough(${job.paidThrough}) <= blockIndex(${job.blockIndex}). Terminating...`);
  const receipt = await terminateJob(job, "unpaid_boundary", {
    docker,
    receiptSink,
    graceMs: 5000,
    providerUaid: "uaid:demo:provider",
  });

  console.log(`\nJob status: ${job.status}`);
  console.log("Terminal receipt:", JSON.stringify(receipt, null, 2));
  console.log(`\nReceipts written to: ${join(dataDir, "receipts", `${jobId}.jsonl`)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
