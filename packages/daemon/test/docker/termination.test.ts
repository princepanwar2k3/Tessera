import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { terminateJob, abortJob } from "../../src/docker/termination.js";
import { FakeDockerRunner } from "../../src/docker/fake-docker-runner.js";
import { LocalFileReceiptSink } from "../../src/receipts/receipt-sink.js";
import type { Job } from "../../src/spec/index.js";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    renterUaid: "uaid:test:renter",
    image: "busybox:latest",
    blockSeconds: 10,
    leadSeconds: 4,
    pricePerBlock: "1500",
    asset: "MOCK",
    blockIndex: 2,
    paidThrough: 2,
    status: "running",
    createdAt: 0,
    containerId: "fake-1",
    ...overrides,
  };
}

describe("terminateJob", () => {
  let dataDir: string;
  let docker: FakeDockerRunner;
  let receiptSink: LocalFileReceiptSink;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "tessera-daemon-test-"));
    docker = new FakeDockerRunner();
    receiptSink = new LocalFileReceiptSink(dataDir);
  });

  it("stops a container that responds to SIGTERM without ever sending SIGKILL", async () => {
    const { containerId } = await docker.createAndStart({} as never);
    const job = makeJob({ containerId });

    await terminateJob(job, "completed", {
      docker,
      receiptSink,
      graceMs: 5000,
      providerUaid: "uaid:test:provider",
    });

    expect(docker.signalsReceived(containerId)).toEqual(["SIGTERM"]);
    expect(docker.isRunning(containerId)).toBe(false);
    expect(job.status).toBe("closed");
  });

  it("force-kills a container that ignores SIGTERM, after the grace period", async () => {
    docker.nextContainerIgnoresSigterm = true;
    const { containerId } = await docker.createAndStart({} as never);
    const job = makeJob({ containerId });

    await terminateJob(job, "unpaid_boundary", {
      docker,
      receiptSink,
      graceMs: 5000,
      providerUaid: "uaid:test:provider",
    });

    expect(docker.signalsReceived(containerId)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(docker.isRunning(containerId)).toBe(false);
    expect(job.status).toBe("expired");
  });

  it("collects artifacts even on expired (unpaid_boundary) termination", async () => {
    const { containerId } = await docker.createAndStart({} as never);
    const job = makeJob({ containerId });

    await terminateJob(job, "unpaid_boundary", {
      docker,
      receiptSink,
      graceMs: 5000,
      providerUaid: "uaid:test:provider",
    });

    expect(job.artifacts).toBeDefined();
    expect(job.artifacts?.stdout).toContain(containerId);
  });

  it("records exactly one terminal receipt with the correct fields", async () => {
    const { containerId } = await docker.createAndStart({} as never);
    const job = makeJob({ containerId, id: "job-receipt-test" });

    const receipt = await terminateJob(job, "unpaid_boundary", {
      docker,
      receiptSink,
      graceMs: 5000,
      providerUaid: "uaid:test:provider",
    });

    expect(receipt.type).toBe("terminated");
    expect(receipt.reason).toBe("unpaid_boundary");
    expect(receipt.finalBlockIndex).toBe(job.blockIndex);

    const lines = (await readFile(join(dataDir, "receipts", "job-receipt-test.jsonl"), "utf-8"))
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: "terminated", reason: "unpaid_boundary" });
  });

  it("handles a job with no container yet (never left awaiting_payment)", async () => {
    const job = makeJob({ containerId: undefined, status: "awaiting_payment" });
    const receipt = await terminateJob(job, "operator_stop", {
      docker,
      receiptSink,
      graceMs: 5000,
      providerUaid: "uaid:test:provider",
    });
    expect(receipt.reason).toBe("operator_stop");
    expect(job.status).toBe("closed");
  });
});

describe("abortJob", () => {
  it("marks the job aborted and records an aborted receipt without touching Docker", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "tessera-daemon-test-"));
    const receiptSink = new LocalFileReceiptSink(dataDir);
    const job = makeJob({ status: "running" });

    const receipt = await abortJob(job, "provider_crash", {
      receiptSink,
      providerUaid: "uaid:test:provider",
    });

    expect(job.status).toBe("aborted");
    expect(receipt.type).toBe("aborted");
    expect(receipt.reason).toBe("provider_crash");
  });
});
