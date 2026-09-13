import Docker from "dockerode";
import { connect } from "node:net";
import type { ContainerSpec, DockerRunner, StartedContainer } from "./docker-runner.js";
import { buildHostConfig } from "./container-config.js";
import type { JobArtifacts } from "../spec/index.js";
import type { Logger } from "../logging.js";

/**
 * Demux a Docker log buffer (non-TTY multiplex format: 8-byte header per
 * frame, byte 0 = stream type 1=stdout/2=stderr, bytes 4-7 = big-endian
 * frame length) into separate stdout/stderr strings.
 */
function demuxLogs(buffer: Buffer): { stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const streamType = buffer.readUInt8(offset);
    const length = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    const chunk = buffer.subarray(start, Math.min(end, buffer.length)).toString("utf-8");
    if (streamType === 2) stderr += chunk;
    else stdout += chunk;
    offset = end;
  }
  return { stdout, stderr };
}

export class DockerodeRunner implements DockerRunner {
  private readonly docker: Docker;
  private readonly artifactDirsByContainer = new Map<string, string>();

  constructor(
    private readonly logger: Logger,
    socketPath = "/var/run/docker.sock",
  ) {
    this.docker = new Docker({ socketPath });
  }

  async createAndStart(spec: ContainerSpec): Promise<StartedContainer> {
    const container = await this.docker.createContainer({
      Image: spec.image,
      Cmd: spec.cmd,
      Env: spec.env ? Object.entries(spec.env).map(([k, v]) => `${k}=${v}`) : undefined,
      ...(spec.exposedPort !== undefined
        ? { ExposedPorts: { [`${spec.exposedPort}/tcp`]: {} } }
        : {}),
      HostConfig: buildHostConfig(spec.caps, spec.artifactHostDir, spec.exposedPort),
      Labels: { "tessera.jobId": spec.jobId },
    });
    await container.start();
    this.artifactDirsByContainer.set(container.id, spec.artifactHostDir);

    const hostPort =
      spec.exposedPort === undefined
        ? undefined
        : await this.readHostPort(container, spec.exposedPort);

    this.logger.info(
      { jobId: spec.jobId, containerId: container.id, hostPort },
      "container started",
    );

    // "Ready" is docker reporting the container running. For a service that
    // publishes a port we wait for it to accept a connection instead, because
    // SPEC §5.2 starts the billing clock at readiness and a renter must not
    // pay for a block the server spent still booting.
    const readyAt = hostPort === undefined ? Date.now() : await this.waitForPort(hostPort);

    return {
      containerId: container.id,
      readyAt,
      ...(hostPort !== undefined ? { hostPort } : {}),
    };
  }

  /** Docker assigns the host port at start; read it back off the container. */
  private async readHostPort(
    container: { inspect: () => Promise<unknown> },
    exposedPort: number,
  ): Promise<number | undefined> {
    const info = (await container.inspect()) as {
      NetworkSettings?: { Ports?: Record<string, Array<{ HostPort?: string }> | null> };
    };
    const binding = info.NetworkSettings?.Ports?.[`${exposedPort}/tcp`]?.[0]?.HostPort;
    const port = binding ? Number(binding) : Number.NaN;
    return Number.isInteger(port) && port > 0 ? port : undefined;
  }

  /**
   * Poll until the published port accepts a connection, or give up.
   *
   * Giving up still returns a timestamp: a workload that never listens is the
   * renter's problem, not a reason for the provider to serve unbilled time.
   */
  private async waitForPort(port: number, timeoutMs = 15_000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const open = await new Promise<boolean>((resolve) => {
        const socket = connect({ host: "127.0.0.1", port });
        const done = (ok: boolean) => {
          socket.destroy();
          resolve(ok);
        };
        socket.once("connect", () => done(true));
        socket.once("error", () => done(false));
        socket.setTimeout(500, () => done(false));
      });
      if (open) return Date.now();
      await new Promise((r) => setTimeout(r, 150));
    }
    this.logger.warn({ port }, "container never accepted a connection; starting the clock anyway");
    return Date.now();
  }

  async kill(containerId: string, signal: "SIGTERM" | "SIGKILL"): Promise<void> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.kill({ signal });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      // 404/409 -> container already gone or already stopped; not an error for us.
      if (statusCode !== 404 && statusCode !== 409) throw err;
    }
  }

  async waitForExit(containerId: string, timeoutMs: number): Promise<boolean> {
    const container = this.docker.getContainer(containerId);
    const waitPromise = container.wait().then(() => true);
    const timeoutPromise = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), timeoutMs),
    );
    try {
      return await Promise.race([waitPromise, timeoutPromise]);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404) return true; // already gone
      throw err;
    }
  }

  async collectArtifacts(containerId: string): Promise<JobArtifacts> {
    const container = this.docker.getContainer(containerId);
    const artifactDir = this.artifactDirsByContainer.get(containerId);
    let stdout = "";
    let stderr = "";
    try {
      const logsBuffer = (await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
      })) as unknown as Buffer;
      ({ stdout, stderr } = demuxLogs(logsBuffer));
    } catch (err) {
      this.logger.warn({ containerId, err }, "failed to collect container logs");
    }
    return { stdout, stderr, artifactDir };
  }
}
