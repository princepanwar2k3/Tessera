/**
 * Embeddable daemon, for `tools/e2e` and for demos.
 *
 * `src/index.ts` is the process entry point: it reads env, opens a Docker
 * socket and never returns. This assembles the same object graph with its
 * dependencies injected, so a test can run a real daemon — real HTTP, real
 * watchdog, real clock — without Docker and without a facilitator.
 */
import { JobRegistry } from "./jobs/job-registry.js";
import { JobStore } from "./jobs/job-store.js";
import { SystemClock, type Clock } from "./jobs/clock.js";
import { Scheduler } from "./jobs/scheduler.js";
import { JobService } from "./jobs/job-service.js";
import { JobEventBus } from "./events/job-events.js";
import { FakeDockerRunner } from "./docker/fake-docker-runner.js";
import type { DockerRunner } from "./docker/docker-runner.js";
import { MockFacilitatorClient } from "./payments/facilitator-client.js";
import type { FacilitatorClient } from "./payments/facilitator-client.js";
import { LocalFileReceiptSink } from "./receipts/receipt-sink.js";
import type { ReceiptSink } from "./receipts/receipt-sink.js";
import { createLogger } from "./logging.js";
import { buildServer } from "./server.js";
import { collectHardwareSpecs } from "./controlplane/specs.js";
import { runBenchmark } from "./controlplane/attestation.js";
import { buildMachineListing } from "./controlplane/control-plane-client.js";
import type { MachineListing } from "@bsp/protocol";

export interface TestDaemonOptions {
  dataDir: string;
  providerId?: string;
  port?: number;
  blockSeconds?: number;
  leadSeconds?: number;
  pricePerBlock?: string;
  asset?: string;
  graceMs?: number;
  watchdogIntervalMs?: number;
  docker?: DockerRunner;
  facilitator?: FacilitatorClient;
  receiptSink?: ReceiptSink;
  clock?: Clock;
  silent?: boolean;
}

export interface TestDaemon {
  url: string;
  providerId: string;
  listing: MachineListing;
  service: JobService;
  registry: JobRegistry;
  events: JobEventBus;
  scheduler: Scheduler;
  close: () => Promise<void>;
}

export async function startTestDaemon(opts: TestDaemonOptions): Promise<TestDaemon> {
  const providerId = opts.providerId ?? "node-test";
  const blockSeconds = opts.blockSeconds ?? 5;
  const leadSeconds = opts.leadSeconds ?? 4;
  const pricePerBlock = opts.pricePerBlock ?? "1500";
  const asset = opts.asset ?? "HBAR";

  const logger = createLogger(providerId);
  if (opts.silent !== false) logger.level = "silent";

  const clock = opts.clock ?? new SystemClock();
  const registry = new JobRegistry();
  const events = new JobEventBus();
  const docker = opts.docker ?? new FakeDockerRunner(clock);
  const facilitator = opts.facilitator ?? new MockFacilitatorClient();
  const receiptSink = opts.receiptSink ?? new LocalFileReceiptSink(opts.dataDir);

  const service = new JobService(
    registry,
    docker,
    facilitator,
    receiptSink,
    clock,
    {
      dataDir: opts.dataDir,
      graceMs: opts.graceMs ?? 200,
      providerUaid: `uaid:local:${providerId}`,
      network: "hedera-testnet",
      payTo: "0.0.PROVIDER",
      facilitatorUrl: "https://facilitator.test",
    },
    logger,
    new JobStore(opts.dataDir),
    events,
  );

  const scheduler = new Scheduler(
    registry,
    clock,
    (job, next) => service.handleAdvance(job, next),
    (job, reason) => service.handleTerminate(job, reason),
    logger,
    opts.watchdogIntervalMs ?? 250,
    (job, blockIndex) => service.announceRenewal(job, blockIndex),
  );
  scheduler.start();

  const specs = collectHardwareSpecs();
  const attestation = runBenchmark();
  const app = buildServer(service, logger, { providerId, specs, attestation }, events);
  await app.listen({ port: opts.port ?? 0, host: "127.0.0.1" });

  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  const listing = buildMachineListing({
    providerId,
    endpoint: url,
    specs,
    attestation,
    blockSeconds,
    leadSeconds,
    pricePerBlock,
    asset,
  });

  return {
    url,
    providerId,
    listing,
    service,
    registry,
    events,
    scheduler,
    close: async () => {
      scheduler.stop();
      await app.close();
    },
  };
}
