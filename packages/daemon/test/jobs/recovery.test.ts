import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobStore } from "../../src/jobs/job-store.js";
import { JobRegistry } from "../../src/jobs/job-registry.js";
import { recoverOrphanedJobs } from "../../src/jobs/recovery.js";
import { LocalFileReceiptSink } from "../../src/receipts/receipt-sink.js";
import { createLogger } from "../../src/logging.js";
import type { Job } from "../../src/spec/index.js";

const logger = createLogger("test");
logger.level = "silent";

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
    containerId: "some-container",
    ...overrides,
  };
}

describe("recoverOrphanedJobs", () => {
  let dataDir: string;
  let store: JobStore;
  let receiptSink: LocalFileReceiptSink;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "tessera-daemon-recovery-test-"));
    store = new JobStore(dataDir);
    receiptSink = new LocalFileReceiptSink(dataDir);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("marks a job left running at crash time as aborted, with a receipt", async () => {
    const job = makeJob({ id: "orphan-running", status: "running" });
    await store.save(job);

    const registry = new JobRegistry();
    await recoverOrphanedJobs(store, registry, receiptSink, "uaid:test:provider", logger);

    const recovered = registry.get("orphan-running")!;
    expect(recovered.status).toBe("aborted");

    const lines = (await readFile(join(dataDir, "receipts", "orphan-running.jsonl"), "utf-8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "aborted", reason: "provider_restart" });
  });

  it("marks a job left starting (never reached running) as aborted too", async () => {
    const job = makeJob({ id: "orphan-starting", status: "starting" });
    await store.save(job);

    const registry = new JobRegistry();
    await recoverOrphanedJobs(store, registry, receiptSink, "uaid:test:provider", logger);

    expect(registry.get("orphan-starting")!.status).toBe("aborted");
  });

  it("leaves an already-terminal job untouched (no duplicate receipt)", async () => {
    const job = makeJob({ id: "already-closed", status: "closed" });
    await store.save(job);

    const registry = new JobRegistry();
    await recoverOrphanedJobs(store, registry, receiptSink, "uaid:test:provider", logger);

    expect(registry.get("already-closed")!.status).toBe("closed");
    await expect(
      readFile(join(dataDir, "receipts", "already-closed.jsonl"), "utf-8"),
    ).rejects.toThrow();
  });

  it("does nothing when there are no persisted jobs", async () => {
    const registry = new JobRegistry();
    await recoverOrphanedJobs(store, registry, receiptSink, "uaid:test:provider", logger);
    expect(registry.list()).toHaveLength(0);
  });
});
