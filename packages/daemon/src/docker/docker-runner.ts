import type { JobArtifacts, ResourceCaps } from "../spec/index.js";

export interface ContainerSpec {
  jobId: string;
  image: string;
  cmd?: string[];
  env?: Record<string, string>;
  caps: ResourceCaps;
  artifactHostDir: string;
}

export interface StartedContainer {
  containerId: string;
  readyAt: number;
}

/**
 * Port that isolates the daemon's job/watchdog logic from Docker itself.
 * DockerodeRunner is the real adapter; FakeDockerRunner is the test double.
 */
export interface DockerRunner {
  createAndStart(spec: ContainerSpec): Promise<StartedContainer>;
  kill(containerId: string, signal: "SIGTERM" | "SIGKILL"): Promise<void>;
  /** Resolves true if the container exited within timeoutMs, false if it's still running. */
  waitForExit(containerId: string, timeoutMs: number): Promise<boolean>;
  collectArtifacts(containerId: string): Promise<JobArtifacts>;
}
