# BSP — phase-wise implementation plan

Block Settlement Protocol v0.1 · block-metered compute on Hedera x402
Target: ETHOnline 2026, Hedera AI & Agentic Payments track

Canonical protocol: [`SPEC.md`](./SPEC.md).
This document is the execution plan: what gets built, in what order, and what must be true before the next phase starts.

---

## How to read this

Eight phases. Each has:

- **Gate** — a single verifiable fact. Nothing in a later phase begins until it holds. Gates are binary; "mostly working" is not a gate.
- **Track A / Track B** — two parallel workstreams for a 2–3 person team, with the sync point at the gate.
- **Verification** — the command or observation that proves the gate. If you can't run it, the gate isn't met.

The team is small and the deadline is real, so two rules bind:

1. **Nothing gets added that isn't in this document.** The cut list (§ Cut list) is the only permitted deviation, and it only ever removes.
2. **Phase 7 is a freeze.** No new surface after it starts, no exceptions.

**Verification posture** (chosen up front): strict TDD for `packages/core` and `packages/protocol` — the block clock, boundary evaluation, `paid_through` accounting, and every row of SPEC §7. Everything else gets smoke tests and one end-to-end harness. The reason is narrow: boundary bugs are invisible until they fire on camera, and they are cheap to test against a fake clock.

---

## Architecture, in one screen

```
                    ┌──────────────────────────┐
                    │      Web console         │
                    │  browse · rent · watch   │
                    └────────────┬─────────────┘
                                 │ REST + SSE
                    ┌────────────▼─────────────┐
   ┌────────────────┤     Control plane        ├───────────────┐
   │                │  registry · job broker   │               │
   │                └────────────┬─────────────┘               │
   │  heartbeat +                │ job placement               │ receipt
   │  listing                    │                             │ mirror
   │                ┌────────────▼─────────────┐               │
   │                │    Provider daemon       │               │
   │                │  x402 gate · executor ·  │               │
   │                │  block clock · watchdog  │               │
   │                └──────┬────────────┬──────┘               │
   │              402/pay  │            │ verify + settle      │
   │                ┌──────▼──────┐  ┌──▼────────────┐         │
   │                │ Renter SDK  │  │  Blocky402    │         │
   │                │   + agent   │  │  facilitator  │         │
   │                └─────────────┘  └──────┬────────┘         │
   │                            ┌───────────▼──────────┐       │
   └────────────────────────────►   Hedera testnet     ◄───────┘
                                │  HTS · HCS topics    │
                                └──────────────────────┘
```

**The control plane is not in the payment path.** It does discovery and placement. Once a job is placed, renter and daemon talk directly; if the control plane dies mid-job, the job keeps running and keeps billing. This is the difference between a centralized marketplace with a crypto button and a marketplace whose operator cannot take your money or stop your job — say it in the README and the video.

### Package map

| Package | Responsibility | Depends on |
|---|---|---|
| `packages/protocol` | Wire types, `blockMeta` + receipt schemas, error codes, §4.1 listing validation, canonical receipt serialization and signing | — |
| `packages/core` | `BlockClock` reducer + job state machine. Pure. No timers, no I/O, no network | `protocol` |
| `packages/hedera` | HCS publish/read, HTS token ops, HCS-14 UAID, mirror-node verification | `protocol` |
| `packages/daemon` | Fastify · x402 gate · `JobExecutor` · clock driver · watchdog · receipt emission | `core`, `protocol`, `hedera` |
| `packages/control-plane` | Fastify + SQLite · registry · heartbeat/liveness · job broker · SSE mirror | `protocol` |
| `packages/sdk` | Renter client: rent, renewal loop, budget cap, artifact retrieval | `protocol` |
| `packages/agent` | Machine selection against budget + spec, cost-per-unit reporting | `sdk` |
| `packages/console` | Vite + React. The meter | `protocol` |
| `tools/fake-facilitator` | Deterministic verify/settle. Offline dev and tests | `protocol` |
| `tools/e2e` | End-to-end harness | all |

Dependency rule: `core` depends only on `protocol`, and **nothing depends on `daemon`**. That keeps the clock testable with no network and no Docker.

### Two decisions already made

**Renewal transport — SSE hint + x402 on the block resource.** The daemon exposes `GET|POST /jobs/:id/blocks/:n` (the x402-gated resource) and `GET /jobs/:id/events` (SSE). SSE emits `renewal` at window open; the SDK then does a stock x402 pay-and-retry against the block URL. The stream is a *hint, never a dependency* — if it drops, the SDK falls back to a timer computed from `clockStartedAt`, so a dead stream can never kill a paid job. This keeps the payment path stock x402 (SPEC §6.1's promise that a client ignoring `blockMeta` still settles correctly) and gives console and SDK one stream shape.

**Executor seam.** `JobExecutor` is an interface. `DockerExecutor` is primary; `ProcessExecutor` is the fallback the risk register calls for if container lifecycle eats Phase 2; `FakeExecutor` backs the unit tests. Roughly thirty lines, and it makes the Phase 2 gate survivable.

---

## Phase 0 — Payment core

**Nothing else matters until this works.** You are starting with no Hedera account, no facilitator access, and no proven x402 round trip, so this is a spike, not a build step. Its output is knowledge plus one recording.

**Gate:** one real x402 payment settled on Hedera testnet through the Blocky402 facilitator, with a HashScan link to the transaction.

**Track A — the spike**
- Create and fund a Hedera testnet account; get operator ID and key into `.env`.
- Start from the [hedera-dev pay-per-request PoC](https://github.com/hedera-dev/x402-inference-pay-per-request-poc), not from the x402 spec. Read working code first.
- Throwaway Express server: `GET /hello` returns `402`, a script pays it, retry returns `200`.
- Write `docs/facilitator-contract.md` from **observed behaviour**, not documentation: exact verify and settle request/response shapes, auth, timing, error bodies, what a duplicate settle does, and how long a round trip actually takes.

**Track B — scaffold**
- Workspace config, `tsconfig.base.json`, vitest, lint. (Already in place.)
- `packages/protocol`: `blockMeta`, receipt, and error-body types transcribed from SPEC §6; `validateListing()` enforcing the §4.1 lead-time floor.
- SPEC.md into the repo as the canonical protocol document. (Already in place.)

**Verification:** the terminal recording, the HashScan URL pasted into `docs/facilitator-contract.md`, and `pnpm -F @bsp/protocol test` green on the listing validator.

**Why this is a hard gate:** if the facilitator's real contract differs from what SPEC §6.1 assumes — different field names, a settle that isn't synchronous, a round trip slower than a 4-second window tolerates — that changes the protocol document and the `lead_seconds` floor. Find out on day one, when changing it is free.

**If the round trip is slower than ~2s:** raise the reference default from 30s/10s and record the demo at 15s/6s rather than 10s/4s. Note the measured number in SPEC §4.1's rationale; it is currently an assertion, and a measurement is better.

---

## Phase 1 — The block clock

**Gate:** every row of SPEC §7 is a passing test against a fake clock, running in milliseconds.

**Track A — `packages/core`, test-first**

The reducer is pure:

```ts
type JobState = {
  status: 'awaiting_payment' | 'starting' | 'running' | 'closing' | 'expired' | 'completed' | 'aborted'
  blockIndex: number      // block currently being served
  paidThrough: number     // highest settled block index
  clockStartedAt?: number
  boundaryAt?: number
}

type Event =
  | { t: 'payment_settled'; blockIndex: number }
  | { t: 'service_ready' }
  | { t: 'service_exited' }
  | { t: 'tick' }

type Effect =
  | { t: 'open_window'; blockIndex: number }
  | { t: 'advance'; blockIndex: number; boundaryAt: number }
  | { t: 'terminate'; reason: string }
  | { t: 'emit_receipt'; blockIndex: number }

function reduce(state: JobState, event: Event, now: number): [JobState, Effect[]]
```

No timers inside. The daemon wraps it in a ticker; tests drive `now` directly.

Tests to write, one per SPEC §7 row plus the invariants:

- Payment confirms inside the window, 500 ms before the boundary → accepted, job advances.
- Payment confirms after the boundary → rejected `410`, job already terminated, payment not captured.
- Payment for block `n+2` while `n+1` unpaid → `409` with `expectedBlockIndex`.
- Duplicate payment for a settled block → idempotent, existing receipt returned, no double charge.
- Payment before window opens → `425` with `windowOpensAt`.
- Provisioning exceeds one block → clock still starts at `service_ready`; block 1 is a full `block_seconds` (SPEC §5.2).
- Service exits mid-block → `completed`, remainder forfeited, no refund (§5.6).
- **I1:** no state sequence reaches `running` with `paidThrough < blockIndex`.
- **I3:** `terminate` is never emitted while `now < boundaryAt`, including when the window has closed unpaid — a payment may still confirm.

**Track B**
- `tools/fake-facilitator`: deterministic verify/settle with switchable behaviours — success, timeout, slow, duplicate. This is what makes Phases 2–5 developable offline and testable in CI.
- Machine listing schema and the attestation benchmark shape (a fixed CPU/memory microbenchmark, one number, honestly labelled).

**Verification:** `pnpm -F @bsp/core test` — every §7 row green, sub-second total. Property test if time allows: for random event sequences, I1 and I3 never break.

---

## Phase 2 — Daemon and the watchdog

**Gate: the watchdog kills a running container at an unpaid boundary, and not one second before it.**

This is the demo. Build it now so you get days of it misfiring and find the bugs before the camera does.

**Track A — `packages/daemon`**
- `JobExecutor` interface; `DockerExecutor` via `dockerode`; `ProcessExecutor` fallback.
- Job lifecycle: accept spec (image, env, resource caps) → gate behind `402` → on block 1 settled, pull and start → `service_ready` starts the clock.
- Clock driver: 250 ms ticker feeding `tick` into `reduce`, executing effects. Boundary evaluated at or after `boundaryAt`, never early (§5.4), within 1 second of it.
- Termination sequence per §5.5, in order: `SIGTERM` → 5 s non-billable grace → `SIGKILL` → flush artifacts → terminal receipt. **Artifacts from paid blocks are delivered even on `expired`** — the renter paid for that work.
- Job state persisted to SQLite so a daemon restart can emit the `aborted` receipt §7 requires for the in-flight block.
- **Resource caps, not optional:** `Memory`, `NanoCpus`, `PidsLimit`, `NetworkMode`, read-only root filesystem. You are running strangers' containers, and someone will ask.

**Track B — `packages/control-plane`**
- Fastify + SQLite skeleton: `POST /providers`, `POST /providers/:id/heartbeat`, `GET /machines` with liveness derived from last heartbeat.
- Registration rejects listings violating the §4.1 lead-time floor, using `protocol`'s validator — a misconfigured provider must not be able to make the protocol look broken.

**Verification:** an integration test against `fake-facilitator` — start a job, pay block 1, pay block 2, let block 3 go unpaid, assert the container is alive at `boundary − 1s` and dead by `boundary + 1s`, and assert the artifact directory survives. Plus one manual run you watch.

**Fallback:** if container lifecycle is still broken at the end of this phase, switch to `ProcessExecutor` and move on. The protocol claim is about settlement, not about Docker.

---

## Phase 3 — Renewal end to end, on testnet

**Gate:** a multi-block job runs against the real facilitator on Hedera testnet, renewing at each boundary, with receipts on HCS.

**Track A — renewal**
- Emit the renewal challenge at `boundaryAt − leadSeconds`, on both the SSE stream and the block resource (§5.3).
- Wire the real facilitator using `docs/facilitator-contract.md`; keep `fake-facilitator` switchable by env var for offline work and CI.
- Implement the §6.3 error codes exactly: `402`, `409`, `410`, `425`, and `200`-with-existing-receipt for duplicates.
- Idempotency keyed on `(jobId, blockIndex)`.

**Track B — `packages/hedera`**
- Receipts per §6.2, published to one shared HCS topic keyed by `jobId`. (Per-job topics are prettier but cost a topic creation and latency on the critical path.)
- Both signatures where available; a provider-only receipt is valid evidence of a claim, not of agreement.
- Mirror-node read path, so the renter can verify settlement independently of the facilitator's confirmation (§8).

**Verification:** run a 6-block job on testnet. Assert six receipts on the topic with correct `blockIndex`, `clockStartedAt`, and `boundaryAt`; open every transaction on HashScan; confirm block 1's duration measured from `service_ready` is a full `block_seconds`.

---

## Phase 4 — Marketplace and SDK

**Gate:** two provider nodes are discoverable through the registry, and a job placed through it runs on the chosen one.

**Track A — second node + registry**
- Second daemon instance, distinct listing (different price *and* different `block_seconds` — that contrast is what makes granularity-as-a-market-variable visible).
- `POST /jobs` places a job and returns the daemon's direct URL. **The control plane never proxies payments.**
- `GET /jobs/:id/events` mirrors the daemon stream for the console; `GET /receipts?job=` reads through to the mirror node.

**Track B — `packages/sdk`**

```ts
const job = await marketplace.rent({
  machine: 'node-a',
  image: 'ghcr.io/you/ffmpeg-transcode:latest',
  maxBlocks: 20,
  budget: hbar(2),
})

job.on('block',      r => console.log(`block ${r.index} settled`, r.txId))
job.on('renewal',    w => console.log(`window open, ${w.msLeft}ms to pay`))
job.on('terminated', r => console.log('ended:', r.reason))

const out = await job.result()
```

- Renewal loop: on `renewal`, check budget and remaining blocks; pay if both allow, otherwise **do nothing** and let the job die at the boundary. That do-nothing path is the kill-switch demo, and it is the natural behaviour rather than a special case.
- Facilitator retry with backoff inside the window; a 10 s window permits several attempts.
- SSE reconnect, with the timer fallback from `clockStartedAt`.
- Artifact retrieval on close.

**Verification:** `tools/e2e` — place through the registry, run to completion, assert the receipt count and total spend. Then kill the control plane mid-job and assert the job keeps running and keeps billing. That test *is* the trust-boundary claim.

---

## Phase 5 — Agent and console

**Gate:** the agent rents a machine unattended and reports cost per unit of work; the console shows the meter moving in real time.

**Track A — `packages/agent`**
- Selects between the two listings against a budget and a required spec, comparing **price and block size together** — a cheaper node with 60 s blocks can cost more for a 90 s job than a dearer node with 15 s blocks. Print the reasoning; a visible decision beats an invisible one.
- Runs the job through the SDK, reports cost per unit of work.

**Track B — `packages/console`**

Screens in build order: **1.** machine list — specs, price per block, block size, live/offline, benchmark result. **2.** job view — the meter, the ticker, container logs. **3.** job history — build only if Phase 5 finishes early.

The console's job is one thing: **make an invisible payment stream visible.**

Design direction is metering — taxi meters, prepaid electricity, instrument panels — not fintech dashboards and not crypto explorers.

| Token | Hex | Use |
|---|---|---|
| `--panel` | `#F2F4F5` | Page ground, cool not cream |
| `--card` | `#FFFFFF` | Surfaces |
| `--ink` | `#101418` | Primary text |
| `--slate` | `#55606B` | Secondary text, rules |
| `--settled` | `#1D7A5F` | Paid blocks, healthy state |
| `--window` | `#C77800` | Renewal window open — the only animated colour |
| `--expired` | `#8E1E23` | Terminated, unpaid |

Amber appears *only* while a renewal window is open, so its appearance carries information instead of decorating. Type: Archivo for UI, Archivo Expanded for the hero meter's numerals, IBM Plex Mono for anything a machine produced — IDs, hashes, transaction IDs, amounts. If a human wrote it, it's Archivo; if a machine did, it's mono.

**The meter** is the signature element and the thing this project is remembered by. A horizontal strip of blocks left to right; the current block fills in real time; at window open it outlines amber with a countdown; on settlement the next block snaps into existence in `--settled` and a receipt line stamps into the mono ticker with its transaction ID; when payment stops the strip freezes, the final block goes `--expired`, status flips to terminated. Everything else on the page stays quiet. The meter is the only thing that moves.

Landing page opens with the meter running live on a demo job, *before* any explanatory copy — the most characteristic thing here is a payment stream you can watch, so lead with the thing itself.

Copy names what the user controls: "Rent", "Stop renewing", "Blocks remaining", "Spend cap" — never "Initiate lease" or "Escrow balance". Empty state: "No machines online. Start a provider node to list one." Errors say what happened and what to do: "Renewal window closed. Job ended at block 5."

Unannounced quality floor: responsive to mobile, visible keyboard focus, `prefers-reduced-motion` respected on the meter.

**Verification:** watch a full job in the console — meter advances, amber appears only inside windows, ticker matches the HCS topic line for line, kill path shows the final block in `--expired`.

---

## Phase 6 — Bonus tracks and deployment

**Gate:** live URLs a judge can hit, and they still work an hour later.

**Track A — deployment**
- Two provider daemons on cheap VPS instances in different regions; systemd units with restart-on-boot; an uptime check.
- Control plane alongside one node; console on Vercel.
- Cache a known-good demo recording as backup footage against testnet or facilitator instability.

**Track B — bonus points**
- **HTS settlement token:** mint a fungible token, use it as the settlement asset, attach a fractional custom fee routing a cut to a treasury account. Zero contract code; makes the business model real rather than hypothetical. **Keep the HBAR fallback path** so a judge without your token can still try it.
- **HCS-14 UAIDs** for both provider nodes and the renter agent, via the Standards SDK. Put the UAID in the receipt and show it in the console.

**Verification:** from a machine that has never touched this project, open the console URL, browse machines, and watch a live job. If that fails, deployment isn't done.

---

## Phase 7 — Freeze

**Gate:** submitted.

**No new surface. This phase is not optional, and every team believes it can skip it.**

- **README**, front-loaded — judges read the top third. Order: title and one-liner → live demo box (console URL, node URL, HCS topic ID, HTS token ID, video link) → the invariants as bullets on the first screen → the problem in three sentences → the protocol with the timeline diagram, a link to SPEC.md, and the edge-case table → **payment flow walked through with real values** (the actual `402` body, the actual transaction ID, a HashScan link, the actual HCS message — this is the qualification requirement and most teams satisfy it with a hand-wavy diagram) → architecture with the trust-boundary note → quickstart (a provider node in under five commands, renting in three lines of SDK) → **status: what's implemented and what isn't**, as a two-column table, direct about the attestation limits → track-requirements table mapping each rubric line to the file or endpoint that satisfies it.
- **Video, ≤5 minutes, aim for three.** 0:00 the claim over a meter already running · 0:20 the problem · 0:50 the protocol on the timeline diagram · 1:20 **the run**, split screen with console left and HashScan right, no cuts · 2:40 **the kill** — stop renewing, countdown, container dies *at the boundary* · 3:10 the HCS topic as public billing history · 3:40 what's next, honestly. No slides before 0:50. Terminal font large enough to read on a phone. **Record three times, keep the cleanest.**
- Record the demo at 10 s blocks with a 4 s window so the meter is visibly active, and say in the video that block size is per-listing and 30 s is the default.
- "What's next" in the README lists everything deliberately not built, one sentence each on how it would work. Naming what you left out is a credibility signal; pretending it's done is not.

---

## Cut list

Cut in this order, and only in this order:

1. The agent's comparison logic → hardcode the choice. **But keep a hardcoded two-machine comparison in the console** — it costs almost nothing and it is the only place configurable granularity does visible work. Without it, per-listing block size is just a config field nobody sees.
2. The second node → say one node, same code.
3. HCS-14 identities.
4. The HTS token.
5. Console polish (job history first, then the landing page).

**Never cut:** the watchdog demo, the README, the freeze.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Facilitator contract differs from SPEC §6.1 assumptions | Medium | Phase 0 is a hard gate specifically to surface this while changing the spec is still free |
| Container lifecycle eats two days | High | Phase 2 hard gate; fall back to `ProcessExecutor` and keep moving |
| A renewal fails on camera | Medium | SDK retry with backoff; ~10 payments per demo rather than 60; record 3× |
| Provider node unreachable during judging | Medium | Two nodes, uptime monitor, restart-on-boot systemd units |
| **Scope creep after the design is settled** | **High** | The cut list is binding and only removes. Nothing gets added |
| Testnet or facilitator instability | Low | Known-good backup recording cached in Phase 6 |

The highest risk here is scope creep. The design is good; the gap between here and a winning submission is execution and presentation, not more surface area.

---

## Requirements checklist

**Qualification**

- [ ] Live x402-gated service on Hedera testnet, settled through Blocky402 — *Phase 3, deployed Phase 6*
- [ ] A platform/agent consuming it, with at least one real paid request end to end — *Phase 5*
- [ ] Public repo, README covering setup, architecture, payment flow — *Phase 7*
- [ ] Video ≤5 minutes showing the paid request executing — *Phase 7*

**Extra points**

- [ ] Compute metering rather than flat per-request — block-metered, priced by duration — *Phase 2*
- [ ] Multi-agent negotiation — *skipped deliberately; noted in "What's next"*
- [ ] On-chain agent identity — HCS-14 UAIDs — *Phase 6*
- [ ] Agent discovery — registry with machine listings — *Phase 4*
- [ ] HTS tokens or custom fee schedules — settlement token with fractional custom fee — *Phase 6*
- [ ] Verifiable audit trails on HCS — signed block receipts per job — *Phase 3*
- [ ] Recurring or streamed payments — the block renewal loop is the streaming primitive — *Phase 3*

Six of seven without stretching any of them. Don't bolt on negotiation to reach seven.

---

## The claim to defend

Not "decentralized AWS". The claim is: **continuous services can be settled safely without escrow, if you prepay in blocks with a renewal lookahead.** Everything in this plan is the demonstration of that one sentence.
