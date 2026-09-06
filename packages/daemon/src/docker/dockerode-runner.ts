import Docker from "dockerode";
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
      HostConfig: buildHostConfig(spec.caps, spec.artifactHostDir),
      Labels: { "tessera.jobId": spec.jobId },
    });
    await container.start();
    this.artifactDirsByContainer.set(container.id, spec.artifactHostDir);
    this.logger.info({ jobId: spec.jobId, containerId: container.id }, "container started");
    // Simplification for this lane: "ready" = docker reports the container
    // running immediately after start() resolves. A real workload-readiness
    // probe (health check, port poll) is out of scope here.
    return { containerId: container.id, readyAt: Date.now() };
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
