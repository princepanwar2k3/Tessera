import type { ContainerSpec, DockerRunner, StartedContainer } from "./docker-runner.js";
import type { JobArtifacts } from "../spec/index.js";
import type { Clock } from "../jobs/clock.js";

interface FakeContainer {
  containerId: string;
  running: boolean;
  ignoreSigterm: boolean;
  killSignalsReceived: Array<"SIGTERM" | "SIGKILL">;
}

/**
 * In-memory DockerRunner test double. Lets tests force the SIGKILL path
 * deterministically by configuring a container to ignore SIGTERM, and lets
 * tests inspect exactly which signals were sent and in what order.
 */
export class FakeDockerRunner implements DockerRunner {
  private readonly containers = new Map<string, FakeContainer>();
  private counter = 0;

  /** Configure the next created container's behaviour. */
  nextContainerIgnoresSigterm = false;

  /**
   * Optional clock so readyAt lines up with a test's FakeClock instead of
   * real wall-clock time. Defaults to Date.now() for tests that don't care.
   */
  constructor(private readonly clock: Clock = { now: () => Date.now(), setInterval: () => 0, clearInterval: () => {} }) {}

  async createAndStart(_spec: ContainerSpec): Promise<StartedContainer> {
    const containerId = `fake-${++this.counter}`;
    this.containers.set(containerId, {
      containerId,
      running: true,
      ignoreSigterm: this.nextContainerIgnoresSigterm,
      killSignalsReceived: [],
    });
    this.nextContainerIgnoresSigterm = false;
    return { containerId, readyAt: this.clock.now() };
  }

  async kill(containerId: string, signal: "SIGTERM" | "SIGKILL"): Promise<void> {
    const container = this.containers.get(containerId);
    if (!container) return;
    container.killSignalsReceived.push(signal);
    if (signal === "SIGKILL" || !container.ignoreSigterm) {
      container.running = false;
    }
  }

  async waitForExit(containerId: string, _timeoutMs: number): Promise<boolean> {
    const container = this.containers.get(containerId);
    if (!container) return true;
    return !container.running;
  }

  async collectArtifacts(containerId: string): Promise<JobArtifacts> {
    return { stdout: `fake stdout for ${containerId}`, stderr: "" };
  }

  // --- test inspection helpers ---

  isRunning(containerId: string): boolean {
    return this.containers.get(containerId)?.running ?? false;
  }

  signalsReceived(containerId: string): Array<"SIGTERM" | "SIGKILL"> {
    return this.containers.get(containerId)?.killSignalsReceived ?? [];
  }
}
