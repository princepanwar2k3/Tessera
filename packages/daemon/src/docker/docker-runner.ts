import type { JobArtifacts, ResourceCaps } from "../spec/index.js";

export interface ContainerSpec {
  jobId: string;
  image: string;
  cmd?: string[] | undefined;
  env?: Record<string, string> | undefined;
  caps: ResourceCaps;
  artifactHostDir: string;
  /**
   * Port inside the container to publish, for workloads that serve something.
   * Omit for batch work, which needs no inbound route.
   */
  exposedPort?: number | undefined;
}

export interface StartedContainer {
  containerId: string;
  readyAt: number;
  /** Host port the container's `exposedPort` was published on, if any. */
  hostPort?: number | undefined;
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
