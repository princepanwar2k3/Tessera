# Tessera

**Block Settlement Protocol (BSP)** — prepaid block settlement for continuous compute,
on Hedera x402.

Rent a container by the block. Each block is paid before it runs, and the window to buy
the next one opens while the current one is still running. Stop paying and the container
dies at the boundary — not a second before, not a second after.

---

## Live demo

Settlement is real. Every block below was paid on **Hedera testnet** through the
Blocky402 facilitator, and every receipt is on a public consensus topic.

| | |
|---|---|
| HCS receipt topic | [`0.0.10507942`](https://hashscan.io/testnet/topic/0.0.10507942) — the public billing history |
| Provider account | [`0.0.10507867`](https://hashscan.io/testnet/account/0.0.10507867) |
| Example settlement | [`0.0.7162784@1789277041.049191367`](https://hashscan.io/testnet/transaction/0.0.7162784@1789277041.049191367) |
| Facilitator | `https://api.testnet.blocky402.com` (x402 v2, `hedera:testnet`) |
| Console | run locally — [Quickstart](#quickstart) |
| Video | *not recorded* |

Not yet deployed to public URLs; the stack runs locally in five commands and
settles against the real network. Nothing here is mocked except, by default,
the facilitator — set `FACILITATOR_MODE=blocky402` and it is real too.

## The invariants

Four properties, and everything else is in service of them. [`SPEC.md §3`](./SPEC.md).

- **I1 — No credit.** The block being served is always already settled. The provider
  never performs unpaid work.
- **I2 — Bounded renter exposure.** The renter's maximum loss is one block.
- **I3 — Deterministic termination.** Service ends at a boundary, never between. There is
  no grace period; the renewal window serves that function.
- **I4 — No custody.** Payment goes renter to provider, directly. No escrow, no treasury,
  no third party ever holds renter funds.

## The problem

x402 is request-shaped: one request, one price, one payment, both sides stateless
afterward. A container has no such unit — it consumes resources continuously while
payments trail behind, and the two obvious answers are both bad: serve on credit and the
provider is exposed for the reconciliation interval, or escrow up front and the renter is
exposed for the whole lease. BSP takes a third path: divide time into fixed blocks,
require each block to be paid before it begins, and open the window to buy block *n+1*
while block *n* is still running, so the lookahead absorbs settlement latency and neither
side extends credit.

## The protocol

Canonical document: [`SPEC.md`](./SPEC.md). One job, at 30-second blocks with a
10-second lead:

```
 clock starts                                                       boundary
 (container ready)                                                      │
      │                block 1 (paid)                                   │
      ├────────────────────────────────────────────┬───────────────────►┤
      0s                                          20s                  30s
                                                   │   renewal window   │
                                                   ├───────────────────►┤
                                                   │                    │
                                        provider offers block 2    provider evaluates:
                                        (402 + SSE `renewal`)      paid_through > block_index ?
                                                                     yes → serve block 2
                                                                     no  → terminate
```

Provisioning — image pull, container create, cold start — happens **before** the clock
starts and is not billed (§5.2). A renter who pays for 30 seconds gets 30 seconds.

### Edge cases

Every row is a test in `packages/core` and `packages/daemon`.

| Case | Behaviour |
|---|---|
| Payment confirms inside the window, before the boundary | Accepted, job advances |
| Payment confirms after the boundary | `410`, job already closed, payment not captured |
| Payment for block `n+2` while `n+1` unpaid | `409` with `expectedBlockIndex` |
| Duplicate payment for a settled block | `200` with the existing receipt, never double-charged |
| Payment attempt before the window opens | `425` with `windowOpensAt` |
| Provisioning exceeds one block | Provider absorbs it; block 1 is still a full block |
| Service exits early | Remainder of the block forfeited, not refunded (§5.6) |
| Renter disappears | Job ends at the next boundary. No cleanup handshake |
| Facilitator times out mid-window | Renter retries with backoff; a 10s window allows several attempts |
| Event stream drops | Renewal continues on a timer derived from `clockStartedAt` |

## Payment flow, with real values

Job `j_546bf8e3`, on Hedera testnet: 20-second blocks with an 8-second renewal
window, three blocks bought and the fourth declined. Renter `0.0.10401938`,
provider `0.0.10507867`, 100,000 tinybars (0.001 ℏ) a block.

**1. The renter places a job.** The control plane asks the chosen daemon to
create it and passes the daemon's answer back untouched.

```
POST http://127.0.0.1:8090/jobs
{ "machineId": "node-a", "renterUaid": "uaid:testnet:0.0.10401938", "image": "busybox:latest" }
```

**2. The daemon answers `402`** — stock x402 plus a namespaced `blockMeta`
extension. A client that ignores `blockMeta` still settles correctly.

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "hedera-testnet",
    "asset": "HBAR",
    "payTo": "0.0.10507867",
    "maxAmountRequired": "100000",
    "resource": "/jobs/j_546bf8e3-8fed-4a5d-8a5a-fa605deef50e/blocks/1",
    "description": "Block 1 of 20s on uaid:local:node-a",
    "facilitator": "https://api.testnet.blocky402.com"
  }],
  "blockMeta": {
    "protocol": "bsp/0.1",
    "jobId": "j_546bf8e3-8fed-4a5d-8a5a-fa605deef50e",
    "blockIndex": 1,
    "blockSeconds": 20,
    "leadSeconds": 8,
    "windowOpensAt": "2026-09-13T10:50:18.060Z",
    "boundaryAt": "2026-09-13T10:50:26.060Z"
  }
}
```

**3. The renter signs and pays the daemon directly** — not the marketplace.
`@bsp/sdk`'s `HederaPayer` translates that requirement to the facilitator's v2
wire with `@bsp/protocol`'s `toV2Requirements`, signs a payload with the
renter's key, and posts it:

```
POST http://127.0.0.1:8080/jobs/j_546bf8e3.../blocks/1/payment
```

**4. The daemon verifies and settles** through Blocky402 — `POST /verify`
returns `{"isValid":true,"payer":"0.0.10401938"}`, then `POST /settle` returns
the transaction. Only then does it pull and start the container, and the clock
starts when the container is ready:

```json
{
  "v": 1,
  "protocol": "bsp/0.1",
  "type": "block_receipt",
  "jobId": "j_546bf8e3-8fed-4a5d-8a5a-fa605deef50e",
  "blockIndex": 1,
  "providerUaid": "uaid:local:node-a",
  "renterUaid": "uaid:testnet:0.0.10401938",
  "asset": "HBAR",
  "amount": "100000",
  "txId": "0.0.7162784@1789277006.060479300",
  "clockStartedAt": "2026-09-13T10:50:06.060Z",
  "boundaryAt": "2026-09-13T10:50:26.060Z"
}
```

That transaction is real:
[hashscan.io/testnet/transaction/0.0.7162784@1789277006.060479300](https://hashscan.io/testnet/transaction/0.0.7162784@1789277006.060479300).
The mirror node shows `SUCCESS`, `0.0.10401938 -100000`, `0.0.10507867 +100000`.

The id is minted under the **facilitator's** account, not the payer's, because
the facilitator co-signs as fee payer and submits. Matching a receipt to a payer
by parsing the txId prefix would be wrong.

**5. Renewal repeats that exchange**, once per block, announced on
`GET /jobs/:id/events` at `boundaryAt - leadSeconds`:

```
… window for block 2 (7.9s left) → paying
✓ block 2 SETTLED ON TESTNET  0.0.7162784@1789277020.991857857
… window for block 3 (8.0s left) → paying
✓ block 3 SETTLED ON TESTNET  0.0.7162784@1789277041.049191367
… window for block 4 (7.8s left) → declining: max_blocks_reached
```

**6. The renter stops buying, and the job ends at the boundary.** Declining is
the whole of the kill switch — no cancel message is sent. The watchdog does the
rest: `SIGTERM`, a non-billable grace period, `SIGKILL`, flush artifacts, emit
the terminal receipt. Artifacts from paid blocks are delivered even though the
job ended `expired`:

```
GET /jobs/j_546bf8e3.../artifacts
{ "status": "expired", "artifacts": { "stdout": "work 0\nwork 1\n…work 65\n" } }
```

**7. The billing history is public.** All four receipts — three blocks and the
termination — are on HCS topic
[`0.0.10507942`](https://hashscan.io/testnet/topic/0.0.10507942), readable by
anyone, with no need to trust the provider's account of what it billed.

## Architecture

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

**The control plane is not in the payment path.** It does discovery and placement, then
gets out of the way: the renter pays the provider directly and watches the provider's own
event stream. If the marketplace operator disappears mid-job, the job keeps running and
keeps billing. That is the difference between a centralised marketplace with a crypto
button and a marketplace whose operator cannot take your money or stop your job.

That claim is a test, not a paragraph —
[`tools/e2e/test/trust-boundary.e2e.test.ts`](./tools/e2e/test/trust-boundary.e2e.test.ts):
the control plane is killed mid-job, blocks 3 and 4 settle with no marketplace in
existence, and every payment request is asserted to have gone to the provider.

### Packages

| Package | Responsibility |
|---|---|
| `packages/protocol` | Wire types, receipt schema and signing bytes, §4.1 listing validation, the fixed benchmark |
| `packages/core` | `BlockClock` reducer and job state machine. Pure — no timers, no I/O |
| `packages/hedera` | HCS publish/read, receipt signing, mirror-node verification |
| `packages/daemon` | Fastify · x402 gate · Docker executor · watchdog · receipts · SSE |
| `packages/control-plane` | Fastify + SQLite · registry · liveness · job broker · SSE mirror |
| `packages/sdk` | Renter client: rent, renewal loop, budget cap, artifacts |
| `packages/agent` | Machine selection on price × block size, cost-per-unit reporting |
| `packages/console` | Vite + React. The meter |
| `tools/fake-facilitator` | Deterministic verify/settle for offline dev and CI |
| `tools/e2e` | Full-stack harness, including the trust-boundary test |

`core` depends only on `protocol`, and nothing depends on `daemon`, so the block clock is
testable with no network and no Docker.

## Quickstart

Requires Node >= 20, pnpm 10, and Docker.

```sh
pnpm install && pnpm -r build          # 1. build the workspace
node packages/control-plane/dist/index.js &   # 2. registry on :8090

# 3. a provider node on :8080, advertising 10s blocks at 1500 each
PORT=8080 PROVIDER_ID=node-a DEFAULT_BLOCK_SECONDS=10 DEFAULT_LEAD_SECONDS=4 \
  CONTROL_PLANE_URL=http://127.0.0.1:8090 node packages/daemon/dist/index.js &

# 4. an agent rents it, unattended, and reports what the work cost
pnpm -F @bsp/agent demo -- --seconds 25 --budget 4500 --units 3 --unit-label frame

pnpm -F @bsp/console dev               # 5. the console on :5173
```

Renting from your own code is three lines:

```ts
const marketplace = new Marketplace({ registryUrl, renterUaid: "uaid:you" });

const job = await marketplace.rent({
  machine: "node-a",
  image: "ghcr.io/you/ffmpeg-transcode:latest",
  budget: hbar(2),
  maxBlocks: 20,
});

job.on("block", (b) => console.log(`block ${b.index} settled`, b.txId));
job.on("renewal", (w) => console.log(`window open, ${w.msLeft}ms to pay`));

const result = await job.result();   // resolves when the job ends
```

To stop paying — the kill switch — call `job.stopRenewing()`. Nothing is sent to the
provider; the job simply ends at the next boundary.

### Settling for real

The quickstart above runs against a mock facilitator and needs no credentials.
To settle on testnet, fund an **ECDSA** account at
[portal.hedera.com](https://portal.hedera.com), put it in `.env`, and start the
daemon with:

```sh
FACILITATOR_MODE=blocky402 FACILITATOR_FEE_PAYER=0.0.7162784 \
  PAY_TO=<provider account> ASSET=HBAR PRICE_PER_BLOCK=100000 \
  DEFAULT_BLOCK_SECONDS=20 DEFAULT_LEAD_SECONDS=8 \
  RECEIPT_SINK=local+hcs HCS_RECEIPT_TOPIC_ID=<topic> \
  node packages/daemon/dist/index.js
```

Then `node tools/e2e/scripts/testnet-demo.mjs`. **The provider and the renter
must be different accounts** — a `payTo` equal to the payer nets to zero and
the facilitator rejects it as an amount mismatch.

### Configuration

Copy [`.env.example`](./.env.example). Two settings decide how much is real:

- `FACILITATOR_MODE` — `mock` (default, no credentials, what CI uses) or `blocky402`.
- `RECEIPT_SINK` — `local` (default) or `hcs` / `local+hcs`, which require
  `HCS_RECEIPT_TOPIC_ID` and operator keys. The daemon refuses to boot without them
  rather than leave the audit log quietly empty.

### If containers fail with `exec /bin/sh: operation not permitted`

Some hosts (AppArmor with certain kernels) refuse to exec anything under Docker's
`no-new-privileges`. Set `NO_NEW_PRIVILEGES=false`. Every other control — read-only root
filesystem, memory, CPU, PID limits, network mode — stays on.

## Status

What is built and tested, and what is not. **330 tests** across ten packages;
`pnpm -r build && pnpm -r test`.

| Built and tested | Not built |
|---|---|
| **Real settlement on Hedera testnet** through Blocky402, verified on the mirror node | Deployment: no public URLs, no uptime checks, no systemd units in service |
| **Receipts published to HCS** and read back through the mirror node | Demo video |
| The block clock: every SPEC §7 row, against a fake clock | HTS settlement token and custom fee (cut list item 4) |
| Provider daemon: lifecycle, watchdog, §5.5 termination order, SQLite crash recovery | HCS-14 UAIDs (cut list item 3) — receipts carry plain string uaids today |
| Docker executor with memory, CPU, PID, network and read-only-rootfs caps | A second provider node — one node, same code (cut list item 2) |
| Renewal challenge on SSE + the block resource; `402`/`409`/`410`/`425`/duplicate-`200` | Hardware attestation — out of scope by SPEC §9; the benchmark says `selfReported: true` |
| Registry with liveness, §4.1 rejection, job broker that never proxies payment | Provider reputation, slashing, dispute resolution, cross-provider migration |
| Renter SDK: renewal loop, budget cap, backoff, stream reconnect, timer fallback | Job history screen (cut list item 5) |
| Agent: selection on price × block size, cost per unit of work | Multi-agent negotiation — deliberately skipped |
| Console: the meter, live against a job's event stream, linked to HashScan | |
| The trust-boundary test: control plane killed mid-job, job keeps billing | |

### What the facilitator turned out to be

`docs/facilitator-contract.md` is written from observed behaviour. Four things
there are worth knowing before integrating against Blocky402:

- It speaks **x402 v2**: `amount` not `maxAmountRequired`, `hedera:testnet`
  not `hedera-testnet`, HBAR as asset `0.0.0`, and a mandatory `extra.feePayer`
  naming its co-signer. SPEC §6.1's envelope is v1, so the translation lives in
  `@bsp/protocol` — used by both sides, because the renter signs over those
  exact requirements and the provider verifies against its own copy.
- **It is not idempotent.** A second settle of the same payload fails
  `DUPLICATE_TRANSACTION` and returns an empty `transaction`. SPEC §6.3's
  "duplicate payment returns the existing receipt" is therefore the daemon's
  guarantee to keep, which it does with a `(jobId, blockIndex)` guard that runs
  before the facilitator is called at all.
- **Failures come back as another `402` with an empty body**; the reason is in
  the `error` field of the `PAYMENT-REQUIRED` header on that response.
- **A `payTo` equal to the payer nets to zero** and is rejected as an amount
  mismatch, with no hint that self-payment was the cause.

### What the measurement changed

SPEC §4.1's four-second floor used to be an assertion. It is now a measurement:
the paid leg runs a median **3.2s** (3.0–3.7s, n=5), and the daemon's separate
verify-then-settle costs ~4.8s. So four seconds admits **one attempt and no
retry**. The floor stays — it exists to reject the unusable — but the spec now
says plainly that a listing wanting retry headroom needs `lead_seconds >= 8`,
and the demo runs at 20s/8s rather than 10s/4s.

## Track requirements

Hedera AI & Agentic Payments track, mapped to where each line is satisfied.

| Requirement | Where | State |
|---|---|---|
| x402-gated service settled through Blocky402 | `packages/daemon/src/payments/blocky402-client.ts`, `src/routes/blocks.route.ts` | **Done — live on testnet** |
| An agent consuming it, with a real paid request end to end | `packages/agent`, `tools/e2e/scripts/testnet-demo.mjs` | **Done — real settlements** |
| Public repo with setup, architecture, payment flow | This file | Done |
| Video ≤5 minutes | — | Not recorded |
| Compute metering rather than flat per-request | `packages/core/src/clock.ts`, `packages/daemon/src/jobs/scheduler.ts` | Done |
| Agent discovery | `packages/control-plane` — `GET /machines` | Done |
| Verifiable audit trails on HCS | topic [`0.0.10507942`](https://hashscan.io/testnet/topic/0.0.10507942) | **Done — live topic** |
| Recurring / streamed payments | The block renewal loop — `packages/sdk/src/job.ts` | Done |
| On-chain agent identity (HCS-14 UAID) | — | Not built |
| HTS token or custom fee schedule | — | Not built |
| Multi-agent negotiation | — | Deliberately skipped |

## What's next

- **Deploy two nodes** in different regions with different `block_seconds`, so
  granularity-as-a-market-variable is visible to a judge rather than only in a test.
- **HCS-14 UAIDs** in receipts and console, replacing today's plain string identifiers.
- **An HTS settlement token** with a fractional custom fee, keeping the HBAR path so
  anyone can try it without holding the token.
- **Workload verification.** BSP settles payment for continuous delivery; it does not
  establish that a provider's advertised hardware is truthful or that delivered work is
  correct. Both need separate mechanisms, and SPEC §9 says so rather than implying
  otherwise.

## Licence

Not yet chosen.
