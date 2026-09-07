import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Job } from "../spec/index.js";

/**
 * Lightweight JSON-file persistence per job, purely for crash recovery
 * (SPEC.md §7: "provider fails mid-block -> MUST emit `aborted` on
 * recovery"). Not a general-purpose datastore — one file per job, full
 * overwrite on every save.
 */
export class JobStore {
  constructor(private readonly dataDir: string) {}

  private path(jobId: string): string {
    return join(this.dataDir, "jobs", `${jobId}.json`);
  }

  async save(job: Job): Promise<void> {
    const path = this.path(job.id);
    await mkdir(join(this.dataDir, "jobs"), { recursive: true });
    await writeFile(path, JSON.stringify(job), "utf-8");
  }

  async remove(jobId: string): Promise<void> {
    try {
      await unlink(this.path(jobId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async loadAll(): Promise<Job[]> {
    const dir = join(this.dataDir, "jobs");
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const jobs: Job[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = await readFile(join(dir, file), "utf-8");
      jobs.push(JSON.parse(content) as Job);
    }
    return jobs;
  }
}
