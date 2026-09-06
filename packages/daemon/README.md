# @bsp/daemon — provider node

Implements the provider side of BSP v0.1 (see repo root `SPEC.md`): gates a job behind an x402 402, owns the block clock, and runs the watchdog that kills a container the instant its block boundary passes unpaid.

Built standalone — no dependency on `packages/protocol` / `packages/core` yet (they've since been merged in; wiring this package to them is open, see `../../claude.md`'s "Status" section). See `../../claude.md` for the team split and the swap-later design of `src/spec/`.

## Quickstart

```bash
pnpm install                            # from repo root
pnpm --filter @bsp/daemon test          # fast tests, no Docker needed
pnpm --filter @bsp/daemon demo:kill     # real container, watchdog kills it at an unpaid boundary
pnpm --filter @bsp/daemon dev           # start the HTTP daemon (needs Docker running)
./scripts/demo-curl.sh                  # full HTTP lifecycle demo, in another terminal
```

## What's real vs. mocked today

| Piece | Status |
|---|---|
| Block clock, watchdog, boundary termination | Real — the whole point of this package |
| Docker container lifecycle (dockerode) | Real |
| Resource caps (memory/cpu/pids/network/readonly-rootfs) | Real |
| x402 payment gate (402/409/410/425/200 decision table) | Real |
| Facilitator payment verification | Mocked (`MockFacilitatorClient` accepts any payload) — swap for a real Blocky402 client behind the same `FacilitatorClient` interface |
| Control-plane registration/heartbeat | No-op by default; set `CONTROL_PLANE_URL` to point at a real one |
| HCS receipt publishing | Not here — this package writes receipt JSON to a local `ReceiptSink`; P3's `packages/hedera` publishes to HCS |
| Hardware attestation | A CPU timing benchmark only, not real attestation (see `src/controlplane/attestation.ts`) |

## Config

See `deployment/ops/.env.example` at the repo root for all environment variables.

## Tests

- `pnpm test` — pure/fake-based tests (boundary logic, lead-time validation, the watchdog scheduler, termination sequencing, payment-gate decision table, full job-service integration). No Docker or wall-clock waiting required.
- `pnpm test:docker` — tests that talk to a real Docker daemon. Opt-in, not part of `pnpm test`.
