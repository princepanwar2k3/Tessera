import type { Job, JobStatus } from "../spec/index.js";

const ACTIVE_STATUSES: JobStatus[] = ["starting", "running"];

export class JobRegistry {
  private readonly jobs = new Map<string, Job>();

  add(job: Job): void {
    this.jobs.set(job.id, job);
  }

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  list(): Job[] {
    return [...this.jobs.values()];
  }

  /** Jobs the watchdog should evaluate at each tick. */
  listActive(): Job[] {
    return this.list().filter((job) => ACTIVE_STATUSES.includes(job.status));
  }

  remove(jobId: string): void {
    this.jobs.delete(jobId);
  }
}
