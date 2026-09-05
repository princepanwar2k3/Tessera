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

- `packages/protocol` — wire types, `validateListing()` (§4.1 floor), receipts, machine listing. No deps.
- `packages/core` — pure `BlockClock` reducer + `getPaymentDecision`. Depends only on `protocol`. No timers/IO/network; tests drive `now` directly.
- `packages/control-plane`, `packages/daemon`, `packages/sdk`, `packages/agent`, `packages/console` — Phase 2+. **Nothing depends on `daemon`.**
- `tools/fake-facilitator` — deterministic verify/settle (`success|slow|timeout|verifyReject|duplicate`), idempotent store. Offline dev + CI. Switchable by env var later.
- `tools/phase0-spike` — THROWAWAY live-money spike (server + payer). Never becomes product code.
- `tools/e2e` — Phase 4 harness (not yet built).

## Status right now

- ✅ **Phase 1 gate (block clock):** `packages/core` 13 tests, `packages/protocol` 7 tests, `fake-facilitator` 5 tests — all green, core suite ~5ms.
- ⏳ **Phase 0 gate (live settlement):** everything scaffolded, 402 leg observed locally. Blocked on one item: funded testnet ECDSA creds in `.env` (see `tools/phase0-spike/README.md`), then run server + pay and paste the HashScan link into `docs/facilitator-contract.md` §5.
- ⏭ **Next after Phase 0:** Phase 2 — daemon + watchdog (`JobExecutor` seam, 250ms ticker, kill at unpaid boundary ±1s).

## Commands

```sh
pnpm install
pnpm -r build && pnpm -r test && pnpm -r typecheck
pnpm --filter @bsp/core test            # one package
pnpm --filter @bsp/phase0-spike server  # spike (needs ../../.env = repo .env)
pnpm --filter @bsp/phase0-spike pay
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
