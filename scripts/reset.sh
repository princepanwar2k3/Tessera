#!/usr/bin/env bash
# Stop every Tessera process, drop rented containers, clear local state.
#
# Written because "kill the old one and start a new one" kept silently failing:
# a stale registry holds :8090, the new one dies with EADDRINUSE, and the only
# symptom is the console reporting "no consensus topic configured" — which
# looks like a config bug and is not one.
set -u

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

echo "stopping Tessera processes…"
for pattern in "control-plane/dist" "daemon/dist" "renter/dist" "provider-cli" "cli.js rent" "packages/console"; do
  for pid in $(pgrep -f "$pattern" 2>/dev/null); do
    cmdline=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cmdline" in *zsh*|*bash*|*pgrep*|*reset.sh*) continue;; esac
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
    case "$cwd" in "$root"*) kill "$pid" 2>/dev/null && echo "  stopped $pid";; esac
  done
done
sleep 2

# Anything still holding a port after SIGTERM gets SIGKILL: a half-dead
# listener is the thing that makes the next start fail invisibly.
for port in 8080 8090 8091 5180; do
  pid=$(ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print $NF}' | grep -oP 'pid=\K[0-9]+' | head -1)
  if [ -n "${pid:-}" ]; then
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
    case "$cwd" in "$root"*) kill -9 "$pid" 2>/dev/null && echo "  force-stopped $pid on :$port";; esac
  fi
done

echo "stopping rented containers…"
ids=$(docker ps -q --filter "ancestor=tessera-demo-site:latest" 2>/dev/null || true)
if [ -n "$ids" ]; then docker stop $ids >/dev/null && echo "  stopped $ids"; else echo "  none"; fi

echo "clearing local state…"
rm -rf "$root/data"

echo
for port in 8080 8090 8091 5180; do
  if curl -sf -m2 "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 || curl -sf -m2 "http://127.0.0.1:$port" >/dev/null 2>&1; then
    echo "  :$port STILL BUSY — something outside this repo is holding it"
  else
    echo "  :$port clear"
  fi
done
echo
echo "Reset. Fund the renter before your take:"
echo "  node --env-file=.env tools/e2e/scripts/set-renter-blocks.mjs 10"
