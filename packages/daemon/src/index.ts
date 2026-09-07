import { loadConfig } from "./config.js";
import { createLogger } from "./logging.js";
import { JobRegistry } from "./jobs/job-registry.js";
import { JobStore } from "./jobs/job-store.js";
import { recoverOrphanedJobs } from "./jobs/recovery.js";
import { SystemClock } from "./jobs/clock.js";
import { Scheduler } from "./jobs/scheduler.js";
import { JobService } from "./jobs/job-service.js";
import { DockerodeRunner } from "./docker/dockerode-runner.js";
import { MockFacilitatorClient } from "./payments/facilitator-client.js";
import { buildReceiptSink } from "./receipts/build-sink.js";
import {
  HttpControlPlaneClient,
  NoopControlPlaneClient,
  type ControlPlaneClient,
} from "./controlplane/control-plane-client.js";
import { runBenchmark } from "./controlplane/attestation.js";
import { collectHardwareSpecs } from "./controlplane/specs.js";
import { buildServer } from "./server.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.providerId);

  const registry = new JobRegistry();
  const jobStore = new JobStore(config.dataDir);
  const clock = new SystemClock();
  const docker = new DockerodeRunner(logger, config.dockerSocketPath);
  const facilitator = new MockFacilitatorClient();
  const receiptSink = buildReceiptSink(config, logger);

  const controlPlane: ControlPlaneClient = config.controlPlaneUrl
    ? new HttpControlPlaneClient(config.controlPlaneUrl)
    : new NoopControlPlaneClient();

  await recoverOrphanedJobs(jobStore, registry, receiptSink, config.providerUaid, logger);

  const service = new JobService(
    registry,
    docker,
    facilitator,
    receiptSink,
    clock,
    {
      dataDir: config.dataDir,
      graceMs: config.gracePeriodMs,
      providerUaid: config.providerUaid,
      network: config.network,
      payTo: config.payTo,
      facilitatorUrl: "https://facilitator.blocky402.com",
    },
    logger,
    jobStore,
  );

  const scheduler = new Scheduler(
    registry,
    clock,
    (job, next) => service.handleAdvance(job, next),
    (job, reason) => service.handleTerminate(job, reason),
    logger,
    config.watchdogIntervalMs,
  );
  scheduler.start();

  const specs = collectHardwareSpecs();
  logger.info({ specs }, "hardware specs collected");
  const attestation = runBenchmark();
  logger.info({ attestation }, "attestation benchmark complete");
  const registration = await controlPlane.register({
    providerId: config.providerId,
    specs,
    attestation,
  });
  logger.info({ registration }, "registered with control plane");

  setInterval(() => {
    void controlPlane.heartbeat(config.providerId).catch((err) => {
      logger.warn({ err }, "heartbeat failed");
    });
  }, 30_000).unref();

  const app = buildServer(service, logger, { providerId: config.providerId, specs, attestation });
  await app.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port }, "daemon listening");

  const shutdown = async () => {
    logger.info("shutting down");
    scheduler.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
