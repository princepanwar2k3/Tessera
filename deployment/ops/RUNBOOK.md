# Provider node runbook

Recommended path: run the daemon directly on the VPS host (Node 20 + systemd), talking to the host's native Docker daemon. Running the daemon *inside* Docker is possible (see `Dockerfile`) but requires bind-mounting `/var/run/docker.sock` into the container, which has real security implications and daemon-in-Docker quirks (e.g. artifact bind-mount host paths must resolve on the host, not inside the daemon's own container). Skip it unless you have a specific reason.

## Setup

1. Provision an Ubuntu VPS. Install Node 20 and Docker Engine. Add a `tessera` service user to the `docker` group:
   ```bash
   sudo useradd -m -s /bin/bash tessera
   sudo usermod -aG docker tessera
   ```
2. Clone the repo, install deps, build:
   ```bash
   git clone <repo-url> && cd eth_global
   pnpm install
   pnpm --filter @bsp/daemon build
   ```
3. Configure:
   ```bash
   cp deployment/ops/.env.example packages/daemon/.env
   # edit PROVIDER_ID, PROVIDER_UAID, PORT as needed
   ```
4. Install as a systemd service:
   ```bash
   ./deployment/ops/scripts/install.sh
   ```
5. Verify:
   ```bash
   curl localhost:8080/healthz
   journalctl -u tessera-daemon -f
   ```

## Firewall

Open the daemon's HTTP port (default 8080) for renter/console access. Leave the Docker socket unexposed — it is only accessed locally by the daemon process.

## Restart-on-crash

The systemd unit sets `Restart=on-failure` with a 3s backoff. On restart, the daemon's boot-time recovery scan (`src/jobs/recovery.ts`) marks any job that was `running`/`starting` when the process died as `aborted` and emits a terminal receipt — it does not attempt to resume tracking a container across a crash.
