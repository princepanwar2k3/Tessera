# Block-metered compute on Hedera — build plan

ETHOnline 2026 · Hedera AI & Agentic Payments track

---

## The paragraph

A payment protocol for renting compute continuously, where you never prepay a deposit and never get locked into a subscription. Renting works on prepaid blocks settled through x402 on Hedera: you pay for the next block while the current one is still running, and the moment you stop paying, your container dies at the boundary. Block length is set by each provider rather than by the protocol, so billing granularity becomes something renters shop on alongside price and specs. The provider is never computing on credit and the renter can never lose more than a single block, so the whole thing runs without escrow, refunds, or dispute resolution. Every receipt settles through the Blocky402 facilitator and lands on Hedera's consensus service, giving both sides a tamper-evident billing history neither can rewrite. We've built it as an open compute marketplace where any agent can discover a machine, rent it, run a job, and walk away, without a human ever touching a payment form.

---

## 1. Scope

### Building

- A published protocol spec for prepaid block settlement
- One control plane (registry + job broker)
- Two provider nodes running the daemon
- A renter SDK and an autonomous agent that uses it
- A web console that makes the meter visible
- HCS receipt log, HTS settlement token, HCS-14 identities

### Not building

Spec attestation beyond a benchmark, GPU passthrough, a scheduler, SSH sessions, long-lived VMs, refunds, escrow, dispute resolution, slashing, staking.

Every item on that list goes in the README under "What's next" with one sentence on how it would work. Naming what you left out is a credibility signal; pretending it's done is not.

### The claim to defend

Not "decentralized AWS." The claim is: **continuous services can be settled safely without escrow, if you prepay in blocks with a renewal lookahead.** Everything else is the demonstration.

---

## 2. The protocol

This is the core of the submission. Write it as `SPEC.md` in the repo before you write the code.

### Terms

| Term | Meaning |
|---|---|
| Block | The atomic unit of rental. Default 30 seconds. |
| Lead time | How long before a block ends the next one can be bought. Default 10 seconds. |
| Renewal window | The final `lead_time` seconds of a block. |
| Boundary | The instant a block ends. |
| Receipt | A signed record that block *n* was paid for and served. |

### Lifecycle

1. Renter requests a job. Daemon replies `402` with the price of block 1, the settlement asset, the facilitator endpoint, and the block parameters.
2. Renter pays block 1. Daemon verifies through the facilitator.
3. Daemon pulls the image and starts the container. **The block clock starts when the container is running, not when payment confirms.** Image pull is on the provider.
4. At `block_end - lead_time`, the daemon emits a renewal challenge: another `402`, for block *n+1*.
5. Renter pays any time before the boundary. Late-but-inside-window is fine.
6. At the boundary: if block *n+1* is settled, continue seamlessly. If not, `SIGTERM` the container, then `SIGKILL` after 5 seconds, flush artifacts, close the job.
7. On job completion inside a paid block, the remaining time is forfeited. This is a minimum billing increment, same as EC2's 60-second minimum.

### Invariants

These are the sentences that make the design defensible. Put them in the README's first screen.

- **The provider never computes on credit.** At every instant, the work in progress is already settled.
- **The renter's maximum loss is one block.** If the provider vanishes mid-block, that is the entire exposure.
- **Termination is deterministic.** It happens at a boundary, never on a timer or a judgment call. No grace period exists, because the renewal window *is* the grace period.
- **No third party holds funds.** Payment goes provider-direct. There is no treasury, no escrow contract, no custody.

### Edge cases — decide these now, document them in SPEC.md

| Case | Rule |
|---|---|
| Payment arrives after the window opens but near the boundary | Accept. Only the boundary matters. |
| Payment arrives after the boundary | Reject. Job is already closed. Funds are not captured. |
| Payment for block *n+2* while *n+1* unpaid | Reject out-of-order. Reply `409` with the expected block index. |
| Duplicate payment for the same block | Idempotent. Return the existing receipt, do not double-charge. |
| Image pull exceeds one block | Provider absorbs it. Clock starts on container ready. |
| Job exits early | Remaining block time forfeited. Documented, not refunded. |
| Provider crashes mid-block | Renter loses at most that block. Daemon posts an `aborted` receipt on restart. |
| Renter disappears | Container dies at the next boundary. No cleanup protocol needed. |
| Facilitator times out during a renewal | Renter retries within the window. Ten seconds is roughly five settlement attempts. |

### Granularity is a market variable

**Block size and lead time are set per listing, not by the protocol.** This is a design position, not a config detail, and it should be stated as prominently as the invariants.

Shorter blocks mean less waste on the final block and tighter control for the renter. Longer blocks mean fewer settlements and more tolerance for network trouble. There is no correct answer, so the protocol doesn't pick one. Providers choose their point on that curve and renters shop on it alongside price and specs.

It also pre-empts the obvious objection. When someone asks "why 30 seconds and not per-second?", the answer isn't a defence of 30 seconds — it's that granularity is a tradeoff the market should price.

Practically: 30s/10s is the default, and you record the demo at 10s/4s so the meter is visibly active.

**Enforce a lead-time floor at registration.** A provider offering 10-second blocks with a 1-second window makes settlement impossible and every job dies at the first boundary — which looks like a broken protocol rather than a misconfigured node. Reject listings that violate:

```
lead_seconds >= 4
lead_seconds >= 0.3 * block_seconds
```

---

## 3. Architecture

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
   │                             │                             │
   │  heartbeat +                │ job placement               │ receipt
   │  listing                    │                             │ mirror
   │                ┌────────────▼─────────────┐               │
   │                │    Provider daemon       │               │
   │                │  x402 gate · docker ·    │               │
   │                │  block clock · watchdog  │               │
   │                └──────┬────────────┬──────┘               │
   │                       │            │                      │
   │              402/pay  │            │ verify + settle      │
   │                ┌──────▼──────┐  ┌──▼────────────┐         │
   │                │ Renter SDK  │  │  Blocky402    │         │
   │                │   + agent   │  │  facilitator  │         │
   │                └─────────────┘  └──────┬────────┘         │
   │                                        │                  │
   │                            ┌───────────▼──────────┐       │
   └────────────────────────────►   Hedera testnet     ◄───────┘
                                │  HTS · HCS topics    │
                                └──────────────────────┘
```

### Trust boundaries

The control plane is **not** in the payment path. It handles discovery and placement only. If it goes down mid-job, the job keeps running and keeps billing, because the daemon and the renter talk directly.

Say this out loud in the README and the video. It's the difference between "a centralized marketplace with a crypto button" and "a marketplace whose operator can't take your money or stop your job."

---

## 4. Layers

### L0 — Payment core

**Do this first. Nothing else matters until it works.**

A throwaway Express server that returns `402` on `GET /hello`, a script that pays it, and a `200` on retry. Start from the [pay-per-request PoC](https://github.com/hedera-dev/x402-inference-pay-per-request-poc) rather than the spec.

Deliverable: a terminal recording of one settled payment and a HashScan link. Do not proceed until you have it.

**402 response shape** (extends the standard with block params):

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "hedera-testnet",
    "asset": "0.0.XXXXXX",
    "payTo": "0.0.PROVIDER",
    "maxAmountRequired": "1500",
    "resource": "https://node-a.example.com/jobs/JOB_ID/blocks/2",
    "description": "Block 2 of 30s on node-a",
    "facilitator": "https://facilitator.blocky402.com"
  }],
  "blockMeta": {
    "jobId": "JOB_ID",
    "blockIndex": 2,
    "blockSeconds": 30,
    "leadSeconds": 10,
    "windowOpensAt": "2026-09-14T10:00:20Z",
    "boundaryAt": "2026-09-14T10:00:30Z"
  }
}
```

`blockMeta` is your extension. Keep it in a namespaced field so a stock x402 client still works.

### L1 — Provider daemon

The most code, and the most likely place to lose a day. Node + TypeScript + `dockerode`.

Responsibilities:

- Register with the control plane on boot, heartbeat every 30s
- Run the attestation benchmark on first registration
- Accept a job spec (image ref, env, resource caps), gate it behind `402`
- Own the block clock: track `block_index`, `boundary_at`, `paid_through`
- Emit the renewal `402` when the window opens
- Verify each payment through the facilitator, write a receipt
- **Watchdog**: at every boundary, check `paid_through > block_index`. If not, terminate.
- Capture stdout/stderr and one artifact directory, return on job close
- Post receipts to the job's HCS topic

**Build the watchdog on day two, not last.** It's your demo. You want three days of it misfiring so you find the bugs before the camera does.

Internal job state:

```ts
type Job = {
  id: string
  renterUaid: string
  image: string
  blockSeconds: number
  leadSeconds: number
  pricePerBlock: bigint
  blockIndex: number        // block currently running
  paidThrough: number       // highest settled block index
  containerId?: string
  startedAt?: number        // clock starts here, not at payment
  boundaryAt?: number
  status: 'awaiting_payment' | 'starting' | 'running' | 'closing' | 'closed' | 'expired'
}
```

Termination check, once per second:

```ts
if (now >= job.boundaryAt) {
  if (job.paidThrough > job.blockIndex) {
    job.blockIndex++
    job.boundaryAt += job.blockSeconds * 1000
  } else {
    await terminate(job, 'unpaid_boundary')
  }
}
```

Resource caps matter: set `Memory`, `NanoCpus`, `PidsLimit`, `NetworkMode`, and a read-only root filesystem. You are running strangers' containers. Even in a demo, someone will ask.

### L2 — Control plane

Node + Fastify + SQLite. Deliberately thin.

- `POST /providers` — register, store attestation results
- `POST /providers/:id/heartbeat` — liveness
- `GET /machines` — listings, filterable, with liveness derived from last heartbeat
- `POST /jobs` — place a job, return the daemon's direct URL
- `GET /jobs/:id/events` — SSE stream mirroring receipts for the console
- `GET /receipts?job=` — read-through to the HCS mirror node

**Never proxy payments.** The renter talks to the daemon directly from the moment a job is placed.

### L3 — Renter SDK and agent

The SDK is a small client that wraps the whole lifecycle:

```ts
const job = await marketplace.rent({
  machine: 'node-a',
  image: 'ghcr.io/you/ffmpeg-transcode:latest',
  maxBlocks: 20,          // budget ceiling
  budget: hbar(2),        // hard spend cap
})

job.on('block', r => console.log(`block ${r.index} settled`, r.txId))
job.on('renewal', w => console.log(`window open, ${w.msLeft}ms to pay`))
job.on('terminated', r => console.log('ended:', r.reason))

const out = await job.result()
```

Renewal loop inside the SDK: on `renewal`, check budget and remaining blocks, pay if both allow, otherwise do nothing and let the job die at the boundary. That "do nothing" path is your kill-switch demo, and it's the natural behaviour, not a special case.

The agent on top: picks a machine from the registry against a budget and a required spec, runs the job, reports cost per unit of work.

Give it one decision worth watching — for example, comparing two nodes at different prices and block sizes and explaining its choice. A visible decision beats an invisible one.

### L4 — HCS receipt log

One topic per job, or one shared topic keyed by job ID. Per-job is cleaner to demo but costs a topic creation each time; shared is fine.

```json
{
  "v": 1,
  "type": "block_receipt",
  "jobId": "JOB_ID",
  "blockIndex": 2,
  "providerUaid": "uaid:...",
  "renterUaid": "uaid:...",
  "amount": "1500",
  "asset": "0.0.XXXXXX",
  "txId": "0.0.1234@1757844000.123456789",
  "clockStartedAt": "2026-09-14T10:00:00Z",
  "boundaryAt": "2026-09-14T10:00:30Z",
  "sig": "..."
}
```

Both sides sign. Now a billing dispute is a matter of public record rather than a support ticket. Terminations get an `aborted` receipt with a reason.

This is one bonus point and about two hours of work.

### L5 — HTS settlement token

Mint a fungible token, use it as the settlement asset instead of raw HBAR. Attach a fractional custom fee so a small cut routes to a treasury account on every transfer. Zero contract code, one more bonus point, and it makes the marketplace's business model real rather than hypothetical.

Roughly an hour, mostly reading docs. Keep an HBAR fallback path so a judge without your token can still try it.

### L6 — Identity

HCS-14 UAIDs for both provider nodes and the renter agent, resolved through the Standards SDK. Put the UAID in the receipt and show it in the console. Under an hour.

### L7 — Web console

See section 6.

---

## 5. Build order

Assumes 2–3 people. Adjust the calendar, keep the order.

| Day | Everyone's blocking goal | Parallel work |
|---|---|---|
| 1 | **One settled x402 payment on testnet.** Nothing else. | Repo scaffold, SPEC.md first draft |
| 2 | Daemon runs a container, block clock ticks, **watchdog kills at an unpaid boundary** | Control plane skeleton, machine listings |
| 3 | Renewal window + full multi-block job end to end | SDK client, HCS receipts |
| 4 | Second provider node live | Console: machine list + live meter |
| 5 | Agent that chooses a machine and reports cost | HTS token, HCS-14, console polish |
| 6 | Freeze. Record video 3×. | README, SPEC final |
| 7 | Buffer for the thing that broke | Submission |

The freeze day is not optional. Every hackathon team believes it can skip it.

**Cut list, in the order you cut them if you fall behind:** the agent's comparison logic (hardcode the choice) → the second node (say one node, same code) → HCS-14 → the HTS token → console polish. Never cut the watchdog demo or the README.

One caveat on the first cut. The agent comparing two nodes on price *and* block size is the only place configurable granularity does visible work — without it, per-listing block size is just a config field nobody sees. If you cut the agent's logic, keep a hardcoded two-machine comparison in the console. It costs almost nothing and preserves the point.

---

## 6. Frontend

The console's job is one thing: **make an invisible payment stream visible.** If a judge watching the video can see money moving and work happening on the same timeline, the console has done its job.

### Direction

The subject's world is metering — taxi meters, prepaid electricity, instrument panels. Not fintech dashboards, not crypto explorers. Design toward a control room readout.

**Palette** (light instrument panel, avoids the near-black-plus-acid-accent look every crypto dashboard has):

| Token | Hex | Use |
|---|---|---|
| `--panel` | `#F2F4F5` | Page ground, cool not cream |
| `--card` | `#FFFFFF` | Surfaces |
| `--ink` | `#101418` | Primary text |
| `--slate` | `#55606B` | Secondary text, rules |
| `--settled` | `#1D7A5F` | Paid blocks, healthy state |
| `--window` | `#C77800` | Renewal window open — the only animated colour |
| `--expired` | `#8E1E23` | Terminated, unpaid |

Two signal colours, one neutral ramp. Amber appears *only* when a renewal window is open, so its appearance carries information instead of decorating.

**Type:** Archivo for UI and display, with the hero meter's numerals set in Archivo Expanded. IBM Plex Mono for every number, ID, hash, and transaction — anything a machine produced. The rule is legible on sight: if a human wrote it, it's Archivo; if a machine did, it's mono. Skip Inter, it reads as the default.

**Signature element — the meter.** This is the one thing to spend effort on and the thing the project is remembered by.

A horizontal strip of blocks running left to right. The current block fills in real time. When it enters the renewal window the block outlines in amber and a countdown appears. When the payment settles, the next block snaps into existence in `--settled` green and a receipt line stamps into a mono ticker below with its transaction ID. When payment stops, the strip freezes, the final block goes `--expired`, and the container status flips to terminated.

Everything else on the page stays quiet. The meter is the only thing that moves.

```
┌────────────────────────────────────────────────────────┐
│  node-a · 4 vCPU · 8 GB          RUNNING               │
│  30s blocks · 10s window         0.15 ℏ / block        │
│                                                        │
│  ▓▓▓▓ ▓▓▓▓ ▓▓▓▓ ▓▓▓▓ ▓▓░░ ░░░░                        │
│   1    2    3    4    5    6                           │
│                        └─ renewal window · 6s          │
│                                                        │
│  spent 0.60 ℏ    paid through block 5    cap 20 blocks │
├────────────────────────────────────────────────────────┤
│  10:00:30  block 4 settled   0.0.1234@1757…  ↗         │
│  10:00:00  block 3 settled   0.0.1234@1757…  ↗         │
│  09:59:30  block 2 settled   0.0.1234@1757…  ↗         │
└────────────────────────────────────────────────────────┘
```

**Landing page:** do not open with a headline and a gradient. Open with the meter, running live on a demo job, before any explanatory copy. The most characteristic thing in this project is a payment stream you can watch, so lead with the thing itself.

**Copy rules:** name what the user controls. "Rent", "Stop renewing", "Blocks remaining", "Spend cap" — not "Initiate lease", "Terminate session", "Escrow balance". An empty machine list says "No machines online. Start a provider node to list one." Errors say what happened and what to do: "Renewal window closed. Job ended at block 5." No apologies, no vagueness.

**Screens, in build order:**

1. Machine list — specs, price per block, block size, live/offline from heartbeat, attestation benchmark result
2. Job view — the meter, the ticker, the container logs
3. Job history — past jobs with total cost and a link to the HCS topic

Build 1 and 2. Build 3 only if you have time on day 5.

**Quality floor, unannounced:** responsive to mobile, visible keyboard focus, `prefers-reduced-motion` respected on the meter animation.

---

## 7. README

Judges read the top third and skim the rest. Front-load everything.

### Structure

**Title and one-liner.** "Prepaid block settlement for continuous compute, on Hedera x402." Then the paragraph from the top of this doc.

**Live demo box.** Above everything: console URL, provider node URL, HCS topic ID, HTS token ID, and the video link. If a judge has to scroll to find your live service, you have already lost points.

**The invariants.** Four bullets, first screen, before any architecture:

> - The provider never computes on credit.
> - The renter's maximum loss is one block.
> - Termination is deterministic, at a block boundary.
> - No escrow, no refunds, no custody. Payment goes provider-direct.
> - Block size is set per listing, so billing granularity is something renters shop on.

This is the paragraph a judge repeats to another judge. Make it easy to find and easy to quote.

**The problem, in three sentences.** Every compute marketplace makes you deposit funds before you know if the machine is good. x402 settles continuously. So the deposit shouldn't be necessary.

**The protocol.** The timeline diagram, the lifecycle steps, a link to `SPEC.md`. Include the edge-case table — it's the section that shows you thought about failure rather than only the happy path.

**Payment flow, with real values.** Walk one job through: the actual `402` body, the actual transaction ID, a HashScan link, the actual HCS message. Real values, not placeholders. This is the qualification requirement and most teams satisfy it with a hand-wavy diagram.

**Architecture.** The ASCII diagram from section 3, plus the trust-boundary note about the control plane being outside the payment path.

**Quickstart.** Run a provider node in under five commands. Rent from it in three lines of SDK. If someone can't reproduce it in ten minutes, they won't try.

**Status: what's implemented, what isn't.** A two-column table. Be direct about the attestation limits: the benchmark raises the cost of lying about hardware, it doesn't make lying impossible, and here's what a production version would need. Judges respect a team that maps its own boundaries.

**Track requirements.** A short table mapping each qualification requirement and each extra-point bullet to the file or endpoint that satisfies it. Judges are scoring against a rubric — hand them the rubric filled in.

### Tone

Plain, specific, no marketing. Numbers where you have them. "Settles in ~2s through Blocky402" beats "lightning-fast settlement." If a sentence would survive being deleted, delete it.

---

## 8. Video

Five minutes maximum. Aim for three.

| Time | Content |
|---|---|
| 0:00–0:20 | The claim in one sentence, over the meter already running |
| 0:20–0:50 | The problem: every marketplace wants a deposit; here's why that's avoidable |
| 0:50–1:20 | The protocol, on the timeline diagram. Prepay, window, boundary. |
| 1:20–2:40 | **The run.** Agent picks a machine, rents it, blocks settle. Split screen: console meter left, HashScan right, updating live. |
| 2:40–3:10 | **The kill.** Stop renewing. Countdown. Container dies *at the boundary*. Make the determinism visible. |
| 3:10–3:40 | HCS topic: the full billing history, publicly auditable |
| 3:40–4:00 | What's next, honestly |

Record at 10-second blocks with a 4-second window so the meter is visibly active. State in the video that block size is per-listing and 30s is the default.

**Rules:** no slides before 0:50. No cuts during the run. Terminal font large enough to read on a phone. Record three times and keep the cleanest.

---

## 9. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Container lifecycle eats two days | High | Day 2 hard gate. If not working by end of day 2, drop to running a bare process instead of Docker. |
| A renewal fails on camera | Medium | Retry logic in the SDK; ~10 payments per demo instead of 60; record 3× |
| Provider node unreachable during judging | Medium | Two nodes, uptime monitor, restart-on-boot systemd unit |
| Scope creep after the design win | **High** | The cut list in section 5 is binding. Nothing gets added. |
| Testnet or facilitator instability | Low | Cache a known-good recording as backup footage |

The highest risk on this list is the one labelled scope creep. You have a good design now, and the instinct will be to expand. The gap between where you are and a winning submission is execution and presentation, not more surface area.

---

## 10. Requirements checklist

**Qualification**

- [ ] Live x402-gated service on Hedera testnet, settled through Blocky402
- [ ] A platform/agent consuming it, with at least one real paid request end to end
- [ ] Public repo, README covering setup, architecture, payment flow
- [ ] Video ≤ 5 minutes showing the paid request executing

**Extra points**

- [ ] Compute metering rather than flat per-request — block-metered, priced by duration
- [ ] Multi-agent negotiation — *skipped; note it in What's next*
- [ ] On-chain agent identity — HCS-14 UAIDs for nodes and renter
- [ ] Agent discovery — registry endpoint with machine listings
- [ ] HTS tokens or custom fee schedules — settlement token with fractional custom fee
- [ ] Verifiable audit trails on HCS — signed block receipts per job
- [ ] Recurring or streamed payments — the block renewal loop is the streaming primitive

Six of seven, without stretching any of them. That's the right ratio. Don't bolt on negotiation to reach seven.

---

## Appendix — stack

One language end to end, TypeScript, because every relevant SDK is TS-first.

| Layer | Choice |
|---|---|
| Provider daemon | Node 20, Fastify, `dockerode` |
| Control plane | Node 20, Fastify, SQLite |
| Chain | `@hashgraph/sdk`, Hashgraph Online Standards SDK for HCS-14 |
| Payments | x402 TS SDK, Blocky402 facilitator |
| Console | Vite + React, SSE for live updates, no state library |
| Agent | `hedera-agent-kit-js` + the renter SDK |
| Deploy | Provider nodes on two cheap VPS instances in different regions; console on Vercel |

Skip Next.js unless you already know it. You need one page that updates in real time, not a framework.
