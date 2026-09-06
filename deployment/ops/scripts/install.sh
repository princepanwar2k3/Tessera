#!/usr/bin/env bash
# Installs and enables the Tessera provider daemon as a systemd service on
# a fresh Ubuntu VPS. Run from the repo root after `pnpm --filter @tessera/daemon build`.
set -euo pipefail

INSTALL_DIR="/opt/tessera"

sudo mkdir -p "$INSTALL_DIR"
sudo rsync -a --exclude node_modules --exclude .git ./ "$INSTALL_DIR/"

if [ ! -f "$INSTALL_DIR/packages/daemon/.env" ]; then
  sudo cp "$INSTALL_DIR/deployment/ops/.env.example" "$INSTALL_DIR/packages/daemon/.env"
  echo "Wrote default .env — edit $INSTALL_DIR/packages/daemon/.env before starting."
fi

sudo cp "$INSTALL_DIR/deployment/ops/systemd/tessera-daemon.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tessera-daemon

echo "Installed. Check status with: sudo systemctl status tessera-daemon"
