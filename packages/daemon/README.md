# @bsp/daemon — provider node

The provider side of BSP v0.1 (see the repo root [`SPEC.md`](../../SPEC.md)).
It gates a job behind an x402 `402`, owns the block clock, settles each block
through the facilitator, and runs the watchdog that stops a container the moment
a block boundary passes unpaid.

## Quickstart

```bash
pnpm install                            # from repo root
pnpm --filter @bsp/daemon test          # fast tests, no Docker needed
pnpm --filter @bsp/daemon demo:kill     # real container, watchdog kills it at an unpaid boundary
pnpm --filter @bsp/daemon dev           # start the HTTP daemon (needs Docker running)
./scripts/demo-curl.sh                  # full HTTP lifecycle demo, in another terminal
```

## Components

| Piece | Where |
|---|---|
| Block clock, watchdog, boundary termination (§5.4, §5.5) | `src/jobs/scheduler.ts`, `src/spec/boundary.ts` |
| x402 payment gate — the `402`/`409`/`410`/`425`/duplicate-`200` table (§6.3, §7) | `src/payments/payment-gate.ts` |
| Blocky402 facilitator client (x402 v2 verify + settle) | `src/payments/blocky402-client.ts` |
| Mock facilitator for offline dev and CI (`FACILITATOR_MODE=mock`) | `src/payments/facilitator-client.ts` |
| Docker executor with memory, CPU, PID, network and read-only-rootfs caps | `src/docker/` |
| Receipts — local, HCS, or both (`RECEIPT_SINK`) | `src/receipts/`, publishing via `@bsp/hedera` |
| HCS-14 provider identity, minted at startup | `src/index.ts` |
| Renewal challenge and event stream (SSE) | `src/routes/events.route.ts` |
| Crash recovery — orphaned jobs are marked `aborted` with a terminal receipt | `src/jobs/recovery.ts` |
| Registration and heartbeat to the control plane | `src/controlplane/` |

Hardware attestation is a self-reported CPU benchmark, not real attestation —
out of scope by SPEC §9.

## Config

See [`.env.example`](../../.env.example) at the repo root.

## Tests

- `pnpm test` — boundary logic, lead-time validation, the watchdog scheduler,
  termination sequencing, the payment-gate decision table, facilitator client,
  HCS receipts, and full job-service integration. No Docker or wall-clock waiting.
- `pnpm test:docker` — tests against a real Docker daemon. Opt-in.
