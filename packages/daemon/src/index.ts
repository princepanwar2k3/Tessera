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
import { Blocky402FacilitatorClient } from "./payments/blocky402-client.js";
import type { FacilitatorClient } from "./payments/facilitator-client.js";
import { buildReceiptSink } from "./receipts/build-sink.js";
import {
  buildMachineListing,
  HttpControlPlaneClient,
  NoopControlPlaneClient,
  type ControlPlaneClient,
} from "./controlplane/control-plane-client.js";
import { runBenchmark } from "./controlplane/attestation.js";
import { collectHardwareSpecs } from "./controlplane/specs.js";
import { buildServer } from "./server.js";
import { providerUaid } from "@bsp/hedera";
import { JobEventBus } from "./events/job-events.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.providerId);

  const registry = new JobRegistry();
  const events = new JobEventBus();

  // HCS-14 identity, derived from this node's name and the account it is paid
  // into. Receipts used to carry a hand-written string that identified
  // nothing; this one is deterministic and other tooling can read it.
  const uaid = await providerUaid({
    name: config.providerId,
    accountId: config.payTo,
    network: config.hederaNetwork,
  });
  logger.info({ uaid }, "HCS-14 provider identity");
  const jobStore = new JobStore(config.dataDir);
  const clock = new SystemClock();
  const docker = new DockerodeRunner(logger, config.dockerSocketPath);
  const facilitator: FacilitatorClient =
    config.facilitatorMode === "blocky402"
      ? new Blocky402FacilitatorClient(
          { baseUrl: config.facilitatorUrl, feePayer: config.facilitatorFeePayer! },
          logger,
        )
      : new MockFacilitatorClient();
  logger.info({ mode: config.facilitatorMode }, "facilitator selected");
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
      resourceCaps: { noNewPrivileges: config.noNewPrivileges },
      providerUaid: uaid,
      network: config.network,
      payTo: config.payTo,
      facilitatorUrl: config.facilitatorUrl,
      publicHost: config.publicHost,
    },
    logger,
    jobStore,
    events,
  );

  const scheduler = new Scheduler(
    registry,
    clock,
    (job, next) => service.handleAdvance(job, next),
    (job, reason) => service.handleTerminate(job, reason),
    logger,
    config.watchdogIntervalMs,
    (job, blockIndex) => service.announceRenewal(job, blockIndex),
  );
  scheduler.start();

  const specs = collectHardwareSpecs();
  logger.info({ specs }, "hardware specs collected");
  const attestation = runBenchmark();
  logger.info({ attestation }, "attestation benchmark complete");
  // Validated here rather than only at the registry: a provider below the
  // SPEC §4.1 lead-time floor should fail on its own machine, loudly, not
  // just quietly fail to appear in the marketplace.
  const endpoint = config.publicUrl ?? `http://127.0.0.1:${config.port}`;
  const listing = buildMachineListing({
    providerId: config.providerId,
    endpoint,
    specs,
    attestation,
    blockSeconds: config.defaultBlockSeconds,
    leadSeconds: config.defaultLeadSeconds,
    pricePerBlock: config.pricePerBlock,
    asset: config.asset,
  });
  logger.info({ listing }, "machine listing built");

  const registration = await controlPlane.register({
    providerId: config.providerId,
    endpoint,
    machines: [listing],
  });
  logger.info({ registration }, "registered with control plane");

  setInterval(() => {
    void controlPlane.heartbeat(config.providerId).catch((err) => {
      logger.warn({ err }, "heartbeat failed");
    });
  }, 30_000).unref();

  const app = buildServer(
    service,
    logger,
    { providerId: config.providerId, specs, attestation },
    events,
  );
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
