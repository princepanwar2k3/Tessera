import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobService } from "../../src/jobs/job-service.js";
import { JobRegistry } from "../../src/jobs/job-registry.js";
import { FakeClock } from "../../src/jobs/fake-clock.js";
import { FakeDockerRunner } from "../../src/docker/fake-docker-runner.js";
import { MockFacilitatorClient } from "../../src/payments/facilitator-client.js";
import { LocalFileReceiptSink } from "../../src/receipts/receipt-sink.js";
import { createLogger } from "../../src/logging.js";
import { buildHostConfig, DEFAULT_RESOURCE_CAPS } from "../../src/docker/container-config.js";

const logger = createLogger("test");
logger.level = "silent";

describe("published workloads", () => {
  let dataDir: string;
  let registry: JobRegistry;
  let service: JobService;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "tessera-port-test-"));
    registry = new JobRegistry();
    const clock = new FakeClock(0);
    service = new JobService(
      registry,
      new FakeDockerRunner(clock),
      new MockFacilitatorClient(),
      new LocalFileReceiptSink(dataDir),
      clock,
      {
        dataDir,
        graceMs: 100,
        providerUaid: "uaid:test:provider",
        network: "hedera-testnet",
        payTo: "0.0.PROVIDER",
        facilitatorUrl: "https://facilitator.test",
        publicHost: "node-a.example.com",
      },
      logger,
    );
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function startJob(exposedPort?: number) {
    const created = service.createJob({
      renterUaid: "uaid:test:renter",
      image: "nginx:alpine",
      blockSeconds: 20,
      leadSeconds: 8,
      pricePerBlock: "100000",
      asset: "HBAR",
      ...(exposedPort !== undefined ? { exposedPort } : {}),
    });
    const jobId = (created.body as { blockMeta: { jobId: string } }).blockMeta.jobId;
    await service.submitPayment(jobId, 1, { proof: "mock" });
    return registry.get(jobId)!;
  }

  it("publishes a URL for a workload that asked for a port", async () => {
    const job = await startJob(80);

    expect(job.serviceUrl).toMatch(/^http:\/\/node-a\.example\.com:\d+$/);
  });

  it("gives batch work no URL — it has nothing to serve", async () => {
    const job = await startJob();

    expect(job.serviceUrl).toBeUndefined();
  });

  it("carries the URL on the snapshot, so the console can link to the live site", async () => {
    const job = await startJob(8080);

    expect(service.snapshot(job.id)?.serviceUrl).toBe(job.serviceUrl);
  });
});

describe("buildHostConfig port publishing", () => {
  it("asks docker for an ephemeral host port, never a fixed one", () => {
    const cfg = buildHostConfig(DEFAULT_RESOURCE_CAPS, "/d", 80) as {
      PortBindings?: Record<string, Array<{ HostPort: string }>>;
    };

    // A fixed host port would collide the moment two renters wanted the same one.
    expect(cfg.PortBindings).toEqual({ "80/tcp": [{ HostPort: "0" }] });
  });

  it("publishes nothing when no port was requested", () => {
    const cfg = buildHostConfig(DEFAULT_RESOURCE_CAPS, "/d") as { PortBindings?: unknown };

    expect(cfg.PortBindings).toBeUndefined();
  });

  it("keeps every other control when publishing a port", () => {
    const cfg = buildHostConfig(DEFAULT_RESOURCE_CAPS, "/d", 80);

    expect(cfg.ReadonlyRootfs).toBe(true);
    expect(cfg.PidsLimit).toBe(128);
    expect(cfg.SecurityOpt).toEqual(["no-new-privileges"]);
  });
});
