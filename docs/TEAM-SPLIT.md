# Tessera — three-person split

Companion to `docs/IMPLEMENTATION-PLAN.md`. The plan is written as Track A / Track B;
this maps those tracks onto three people, names the ownership boundaries, and says
who is blocked on whom at each gate.

Committed alongside the code it describes - `docs/` is no longer gitignored.

---

## The three lanes

Each lane owns whole packages. **Nobody edits a package they do not own** — cross-lane
needs are met by agreeing the interface at a gate, then working against it. That single
rule is what makes three people faster than two here instead of slower.

| | Lane | Owns | The one sentence |
|---|---|---|---|
| **P1** | **Protocol & Clock** | `packages/protocol`, `packages/core`, `packages/control-plane`, `tools/fake-facilitator`, `tools/e2e` | Owns correctness: every row of SPEC §7 and the invariants I1–I4. |
| **P2** | **Provider node** | `packages/daemon`, deployment/ops | Owns the demo: a container that dies at the boundary and not a second before. |
| **P3** | **Chain & renter surface** | `packages/hedera`, `packages/sdk`, `packages/agent`, `packages/console` | Owns what a judge sees: receipts on HCS, three lines of SDK, the meter. |

Why this cut and not another: the plan's hard dependency rule is `core → protocol` only,
and nothing depends on `daemon`. So P1's work is pure and testable with no network, P2's
work is the only place Docker exists, and P3's work is the only place a browser or a
mirror node exists. Three lanes, three failure domains, no shared build.

---

## Phase by phase

| Phase | P1 — Protocol & Clock | P2 — Provider node | P3 — Chain & surface | Gate (all three sync here) |
|---|---|---|---|---|
| **0 · Payment core** | `packages/protocol`: `blockMeta`, receipt, error types from SPEC §6; `validateListing()` with the §4.1 floor | Throwaway `402` server + pay script; writes `docs/facilitator-contract.md` from **observed** behaviour | Hedera testnet account funded, operator keys into `.env`; pairs with P2 on the spike, owns the HashScan evidence | One real x402 payment settled on testnet, HashScan link in the contract doc |
| **1 · Block clock** | **The whole phase.** `reduce()` test-first, one test per §7 row + I1/I3 property tests | `JobExecutor` interface + `FakeExecutor` + `DockerExecutor` spike, against a stub reducer | `tools/fake-facilitator` (success / slow / timeout / duplicate), listing schema, benchmark shape | `pnpm -F @bsp/core test` green on every §7 row, sub-second |
| **2 · Daemon & watchdog** | `control-plane` skeleton: `POST /providers`, heartbeat, `GET /machines`, registration rejects §4.1 violations | **The whole phase.** Lifecycle, 250 ms clock driver, §5.5 termination order, SQLite persistence, resource caps | `packages/hedera`: HCS topic create, publish, read; receipt canonical form + signing | Watchdog kills the container **at** an unpaid boundary — alive at −1 s, dead by +1 s |
| **3 · Renewal on testnet** | Integration tests for `402`/`409`/`410`/`425`/duplicate-`200`; idempotency on `(jobId, blockIndex)` | Renewal challenge on SSE + block resource; wires the real facilitator behind an env switch | Receipts per §6.2 to the shared topic; mirror-node read path for independent verification | 6-block testnet job, six correct receipts, block 1 measures a full `block_seconds` from `service_ready` |
| **4 · Marketplace & SDK** | `POST /jobs` placement, SSE mirror, `GET /receipts`; writes the **kill-the-control-plane** e2e test | Second node instance — different price *and* different `block_seconds` | **`packages/sdk`:** renewal loop, budget cap, backoff, SSE reconnect + timer fallback, artifacts | Job placed through the registry runs on the chosen node; job survives the control plane being killed |
| **5 · Agent & console** | `tools/e2e` hardening; holds the freeze line | Ops prep: systemd units, restart-on-boot, uptime check | **The whole phase.** `agent` selection (price × block size, reasoning printed) and the console meter | Agent rents unattended and reports cost/unit; meter moves live, amber only inside windows |
| **6 · Bonus & deploy** | Verifies §4.1 and §7 still hold on deployed nodes; drafts the track-requirements table | Two VPS daemons in different regions, control plane, uptime check, backup recording | HTS settlement token + fractional custom fee (HBAR fallback kept); HCS-14 UAIDs in receipts and console | A cold machine opens the console URL and watches a live job — and it still works an hour later |
| **7 · Freeze** | README structure + the invariants + edge-case table + status table (what's built, what isn't) | Runs the demo three times, keeps the cleanest; guards the nodes during judging | Video edit; the payment walkthrough with **real values** (real `402` body, real txId, real HCS message) | Submitted |

---

## Interface contracts — agree these, then stop talking

These are the only cross-lane surfaces. Each is fixed at the gate named, and changing
one after that is a three-person conversation, not a commit.

| Surface | Between | Fixed at |
|---|---|---|
| `reduce(state, event, now) → [state, effects]` | P1 → P2 | Gate 1. P2 codes against the signature from day one of Phase 1, with a stub. |
| `JobExecutor` interface | P2 internal, P1 tests against `FakeExecutor` | Gate 1 |
| Facilitator request/response shapes | P2's `docs/facilitator-contract.md` → P1's `fake-facilitator` → everyone | Gate 0. If the real contract differs from SPEC §6.1, the **spec changes**, at gate 0, while it is free. |
| Receipt canonical bytes + signing | P3 → P1 (schema lives in `protocol`) | Gate 2 |
| Daemon HTTP surface: `GET\|POST /jobs/:id/blocks/:n`, `GET /jobs/:id/events` | P2 → P3 (SDK) and P1 (control-plane mirror) | Gate 2 |
| SSE event shape (`renewal`, `block`, `terminated`) | P2 → P3 (SDK + console) | Gate 2 |
| Machine listing schema | P1 → P2 (advertises) and P3 (renders) | Gate 1 |

---

## Blocking structure

- **Phase 0 is the only phase where all three are on one thing.** Do not split it —
  the facilitator's real behaviour is the input to everything else.
- **P2 is never blocked on P1** after gate 1, because the reducer signature is fixed on
  day one and `FakeExecutor` + the stub cover the gap.
- **P3 is the long pole.** `hedera` (Phase 2–3), `sdk` (Phase 4), `agent` + `console`
  (Phase 5) is the heaviest sequence in the plan. Watch it from Phase 3 onward.
- **If P3 slips**, P1 takes the console's machine-list screen (screen 1 — it is mostly
  reading the registry P1 already owns) and P2 takes HCS-14 UAIDs. Do this early, not
  in Phase 6.
- **If P2's container lifecycle eats Phase 2**, the plan's own fallback applies: switch
  to `ProcessExecutor`, ship, and say so. The claim is about settlement, not Docker.

---

## Cut list ownership

The plan's cut list is binding and only ever removes. Who executes each cut:

1. Agent comparison logic → hardcode — **P3** (keeps the two-machine comparison in the console)
2. Second node → **P2**
3. HCS-14 identities → **P3**
4. HTS token → **P3**
5. Console polish, job history first → **P3**

**Never cut:** the watchdog demo (P2), the README (P1), the freeze (all).

Note the shape of that list: four of five cuts are P3's. That is deliberate — the lane
with the most surface is the lane with the most droppable surface, so a slip there costs
polish, never the claim.

---

## Working rules

- Branch per lane, merge at gates. Trunk stays gate-green.
- A gate is binary. "Mostly working" is not a gate, and the next phase does not start.
- Daily: one message per lane — what moved, what is blocked, nothing else.
- Phase 7 is a freeze. No new surface after it starts. Every team believes it can skip
  this; the ones that do submit a broken demo.
