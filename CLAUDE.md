# Tessera — CLAUDE.md

Block-metered compute marketplace on Hedera (x402 + HCS + HTS). ETHOnline 2026 submission.

Read `PLAN.md` (build plan) and `SPEC.md` (BSP v0.1 protocol spec) before making protocol-level decisions — they are the source of truth, this file is just orientation.

## Team split — three lanes, whole-package ownership

Nobody edits a package they don't own. Cross-lane needs are met by agreeing an interface at a gate, then working against it — not by reaching into another lane's package.

| Lane | Owns | One sentence |
|---|---|---|
| P1 — Protocol & Clock | `packages/protocol`, `packages/core`, `packages/control-plane`, `tools/fake-facilitator`, `tools/e2e` | Owns correctness: every row of SPEC §7 and invariants I1–I4. Pure, testable, no network. |
| **P2 — Provider node** | `packages/daemon`, `deployment/ops` | **Owns the demo: a container that dies at the boundary and not a second before.** The only lane where Docker exists. |
| P3 — Chain & renter surface | `packages/hedera`, `packages/sdk`, `packages/agent`, `packages/console` | Owns what a judge sees: receipts on HCS, three lines of SDK, the meter. |

Dependency rule: `core → protocol` only. Nothing depends on `daemon` — it's a leaf package.

**This working directory's active session is building P2** (`packages/daemon` + `deployment/ops`). See `/Users/arpitagrawal/.claude/plans/optimized-soaring-shell.md` for the detailed implementation plan for that lane.

## P2 design decision: standalone build

`packages/protocol` / `packages/core` (P1's) don't exist yet, so `packages/daemon` is built standalone with its own internal types/logic mirroring SPEC.md, isolated in `src/spec/` behind a single barrel export (`src/spec/index.ts`). Every other module in the daemon imports types/logic *only* through that barrel, never the individual files inside `src/spec/`.

When P1 ships real `protocol`/`core` packages, the swap is: replace `spec/index.ts`'s contents with re-exports from `@tessera/protocol` (keep `boundary.ts` only if daemon-specific orchestration diverges), add the workspace deps. One-directory diff, not a rewrite.

External dependencies the daemon needs but doesn't own (facilitator verification, control-plane registration, HCS receipt publishing) are all behind small TS interfaces with a working mock/no-op/local default, so the daemon runs fully end-to-end today with zero other packages built. Swapping in the real thing later is a config change plus one new adapter class.

## Workspace

pnpm workspaces. Root `package.json` + `pnpm-workspace.yaml` (`packages/*`, `tools/*`) + `tsconfig.base.json` are the only footprint outside individual packages — no placeholder folders for lanes that haven't started their package yet.

```
pnpm install                              # from repo root
pnpm --filter @tessera/daemon dev         # run the daemon
pnpm --filter @tessera/daemon test        # fast tests, no Docker/wall-clock needed
pnpm --filter @tessera/daemon test:docker # Docker-dependent integration tests (needs Docker running)
pnpm --filter @tessera/daemon demo:kill   # scripts/demo-kill.ts — watchdog kills a real container, no HTTP
```

## Conventions

- TypeScript throughout, Node 20+, ESM (`"type": "module"`).
- Fastify for HTTP, `dockerode` for container control, `pino` for logging, `zod` for config/input validation, `vitest` for tests.
- Time-dependent logic (the watchdog, boundary evaluation) is designed around an injectable `Clock` so tests use a `FakeClock.tick(ms)` instead of real waiting — never sleep in a test to wait for a timer.
- Docker-dependent tests are tagged `*.integration.test.ts` and run only via `test:docker`, never the default `test` script, so `pnpm test` never requires Docker to be installed.
- The watchdog/boundary logic is the single most demo-critical piece (PLAN.md is explicit about this) — it gets the most test investment and should be built before the HTTP surface, not after.
