# Tessera — agent onboarding

Block Settlement Protocol (BSP) v0.1: prepaid block settlement for continuous
compute on Hedera x402. Renter prepays each fixed-length block before it
starts; a renewal lookahead window absorbs settlement latency. No escrow,
no credit, provider-direct payment.

## The four invariants (never break these)

- **I1 — No credit.** The served block is always already settled.
- **I2 — Bounded renter exposure.** Max loss = one block.
- **I3 — Deterministic termination.** At a boundary, never early, no grace period.
- **I4 — No custody.** Renter → provider directly. No escrow/treasury.

## Canonical docs (read in this order)

1. `SPEC.md` — the protocol. Authority on lifecycle, wire format, error codes.
2. `IMPLEMENTATION-PLAN.md` — 8 phases, gates, package map, cut list.
   Rule: **nothing gets added that isn't in this document.**
3. `docs/facilitator-contract.md` — Blocky402 testnet contract from *observed*
   behaviour. Sections are labeled OBSERVED / PREDICTED / PENDING — only build
   on OBSERVED lines.

## Layout

Three-lane split, whole-package ownership — nobody edits a package they don't own; cross-lane needs are met by agreeing an interface at a gate, then working against it.

| Lane | Owns | One sentence |
|---|---|---|
| P1 — Protocol & Clock | `packages/protocol`, `packages/core`, `packages/control-plane`, `tools/fake-facilitator`, `tools/e2e` | Owns correctness: every row of SPEC §7 and invariants I1–I4. Pure, testable, no network. |
| P2 — Provider node | `packages/daemon`, `deployment/ops` | Owns the demo: a container that dies at the boundary and not a second before. The only lane where Docker exists. |
| P3 — Chain & renter surface | `packages/hedera`, `packages/sdk`, `packages/agent`, `packages/console` | Owns what a judge sees: receipts on HCS, three lines of SDK, the meter. |

- `packages/protocol` — wire types, `validateListing()` (§4.1 floor), receipts, machine listing. No deps.
- `packages/core` — pure `BlockClock` reducer + `getPaymentDecision`. Depends only on `protocol`. No timers/IO/network; tests drive `now` directly.
- `packages/daemon` (`@bsp/daemon`) — **built**, not a placeholder: the provider node. Own block clock/watchdog, dockerode container lifecycle + resource caps, x402 payment gate (402/409/410/425/200), crash recovery. Built standalone today (its own `src/spec/` mirrors protocol/core's concepts) because this package existed before `@bsp/protocol`/`@bsp/core` were merged in — wiring it to import the real ones instead is still open, see "Status" below. `deployment/ops` has the systemd unit / Dockerfile / runbook for running it on a VPS.
- `packages/control-plane`, `packages/sdk`, `packages/agent`, `packages/console` — not yet built. **Nothing depends on `daemon`.**
- `tools/fake-facilitator` — deterministic verify/settle (`success|slow|timeout|verifyReject|duplicate`), idempotent store. Offline dev + CI. Switchable by env var later.
- `tools/phase0-spike` — THROWAWAY live-money spike (server + payer). Never becomes product code.
- `tools/e2e` — Phase 4 harness (not yet built).

## Status right now

- ✅ **Phase 1 gate (block clock):** `packages/core` 13 tests, `packages/protocol` 7 tests, `fake-facilitator` 5 tests — all green, core suite ~5ms.
- ⏳ **Phase 0 gate (live settlement):** everything scaffolded, 402 leg observed locally. Blocked on one item: funded testnet ECDSA creds in `.env` (see `tools/phase0-spike/README.md`), then run server + pay and paste the HashScan link into `docs/facilitator-contract.md` §5.
- ✅ **P2 (provider daemon):** `packages/daemon` built independently in parallel with Phase 1 — 49 tests green (watchdog/boundary logic, termination sequencing, payment-gate decision table, full job lifecycle integration), typechecks and builds under this repo's merged `tsconfig.base.json`. HTTP surface + real dockerode container lifecycle smoke-tested manually. Not yet demoed against a real Docker daemon in this environment (none installed here) — run `pnpm --filter @bsp/daemon demo:kill` wherever Docker is available to see it. `GET /healthz` also returns the node's real host specs (CPU/RAM/platform, via `src/controlplane/specs.ts`) and the attestation benchmark result — useful for inspecting what registration would send before `packages/control-plane` exists to receive it.
- ⏭ **Open integration work:** `packages/daemon/src/spec/` is still a local mirror of protocol/core's concepts, not an import of them (it predates this merge). Swapping `spec/index.ts` for real `@bsp/protocol`/`@bsp/core` re-exports — and reconciling `@bsp/core`'s richer `JobState`/`reduce`/`getPaymentDecision` reducer against the daemon's simpler `evaluateBoundary`/`decidePayment` — is the next P1↔P2 gate, not yet done.
- ⏭ **Next after Phase 0:** Phase 2 — daemon + watchdog (`JobExecutor` seam, 250ms ticker, kill at unpaid boundary ±1s). Largely superseded by the `packages/daemon` work above; reconcile the two rather than rebuilding.

## Commands

```sh
pnpm install
pnpm -r build && pnpm -r test && pnpm -r typecheck
pnpm --filter @bsp/core test            # one package
pnpm --filter @bsp/phase0-spike server  # spike (needs ../../.env = repo .env)
pnpm --filter @bsp/phase0-spike pay
pnpm --filter @bsp/daemon test          # daemon: fast tests, no Docker needed
pnpm --filter @bsp/daemon demo:kill     # daemon: real container, watchdog kills it at an unpaid boundary
pnpm --filter @bsp/daemon dev           # daemon: start the HTTP server (needs Docker running)
```

## Conventions & gotchas (earned, don't relearn)

- **Strict TDD for `core` + `protocol`** (boundary bugs are invisible until demo day). Everything else: smoke tests + e2e harness.
- `exactOptionalPropertyTypes` is on — optional fields need `| undefined` when assigned explicitly.
- `tsconfig.json` per package includes `src` only; vitest handles `test/` separately.
- Facilitator = `https://api.testnet.blocky402.com` (open, no key), `hedera:testnet` exact v2, fee payer `0.0.7162784`. Wire is x402 **v2** (`amount`, `extra.feePayer`, `X-PAYMENT` header) — SPEC §6.1 still shows v1 shapes; reconciliation is flagged in `wire.ts` + contract doc §2 and happens in Phase 3, not before.
- `PrivateKey` must come from `@x402/hedera`'s re-export (same bundled SDK copy as the signer), never the top-level `@hiero-ledger/sdk`.
- `emit_receipt` effects are keyed on `(jobId, blockIndex)` — duplicates re-emit it; the daemon must return the existing receipt, never republish.
- Accounts must be **ECDSA**; price in HBAR (`asset: "0.0.0"`, tinybar strings) to skip token association.
- Paid-leg round-trip time (printed by `pay.mjs`) is the empirical input to SPEC §4.1's lead-time floor — if >~2s, raise the reference default per the plan.
- `packages/daemon` follows the same "drive `now` directly, never sleep in a test" discipline as `core`, via an injectable `Clock` + a `FakeClock.tick(ms)` test double — same idea as core's pure reducer, just with an interval-based watchdog instead of a pure `reduce()` function. Docker-dependent tests are tagged `*.integration.test.ts` and run only via `test:docker`, never the default `test`, so CI never needs Docker installed.
- First-party package scope is **`@bsp/*`** (matches the protocol's own name), not `@tessera/*` — `packages/daemon` was originally named `@tessera/daemon` and had to be renamed after the P1 merge. Name any new package (`packages/hedera`, `packages/sdk`, `packages/agent`, `packages/console`, `packages/control-plane`) `@bsp/<name>` from the start.
- **macOS is case-insensitive**: a root-level `CLAUDE.md` and this file (`claude.md`) collide as the same file on disk, even though git tracks them as distinct paths. This repo standardizes on lowercase `claude.md`; the `.gitignore`-based `CLAUDE.md`/`!claude.md` trick some checkouts use only matters if a second such file gets created — don't recreate an uppercase one.
- **Merging another lane's repo** (this happened once for P1, will happen again for P3): each lane independently scaffolded its own root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, and `pnpm-lock.yaml` — expect all five as `git merge --allow-unrelated-histories` add/add conflicts every time, plus a `CLAUDE.md`/`claude.md` case-collision if that lane also created an uppercase onboarding doc (resolve that one *before* merging, not during — remove/rename the file first). For `tsconfig.base.json` specifically, prefer whichever side has hard structural dependents (e.g. `composite`/`references` in P1's `protocol`/`core`) and fix the more flexible package instead of loosening the shared config. Never hand-merge `pnpm-lock.yaml` — delete it and run `pnpm install` fresh once the other conflicts are resolved.
