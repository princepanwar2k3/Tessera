# Tessera

**Block Settlement Protocol (BSP)** — prepaid block settlement for continuous compute,
on Hedera x402.

Rent a container by the block. Each block is paid before it runs, and the window to buy
the next one opens while the current one is still running. Stop paying and the container
dies at the boundary — not a second before, not a second after.

---

## Live demo

> **Not yet deployed.** The Phase 0 gate — one real settlement on Hedera testnet — is
> still open, because it needs a funded testnet ECDSA account that this repository does
> not and should not contain. See [Status](#status) for exactly what that blocks.
>
> Everything below runs today against the local stack, with a mock facilitator and real
> Docker containers. [Quickstart](#quickstart) is five commands.

| | |
|---|---|
| Console | *pending deployment* |
| Provider node | *pending deployment* |
| HCS receipt topic | *pending — needs a funded testnet account* |
| HTS settlement token | *not built (cut list item 4)* |
| Video | *not recorded* |

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

From a local run — control plane, provider daemon, a real `busybox` container, and the
**mock** facilitator. The shapes are the real ones; the transaction ids are minted by the
mock, not by Hedera. Replacing them with testnet values is exactly what the Phase 0 gate
is waiting on.

**1. The renter places a job.** The control plane asks the chosen daemon to create it and
passes the daemon's answer back untouched.

```
POST http://127.0.0.1:8090/jobs
{ "machineId": "node-a", "renterUaid": "uaid:demo:agent", "image": "busybox:latest" }
```

**2. The daemon answers `402`** with the payment requirement — stock x402 plus a
namespaced `blockMeta` extension. A client that ignores `blockMeta` still settles
correctly.

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "hedera-testnet",
    "asset": "HBAR",
    "payTo": "0.0.XXXXXX",
    "maxAmountRequired": "1500",
    "resource": "/jobs/j_d884fd4c-aa55-4347-9988-1dca32fec3e0/blocks/1",
    "description": "Block 1 of 10s on uaid:local:node-a",
    "facilitator": "https://api.testnet.blocky402.com"
  }],
  "blockMeta": {
    "protocol": "bsp/0.1",
    "jobId": "j_d884fd4c-aa55-4347-9988-1dca32fec3e0",
    "blockIndex": 1,
    "blockSeconds": 10,
    "leadSeconds": 4,
    "windowOpensAt": "2026-09-12T18:16:07.955Z",
    "boundaryAt": "2026-09-12T18:16:11.955Z"
  }
}
```

**3. The renter pays the daemon directly** — not the marketplace.

```
POST http://127.0.0.1:8080/jobs/j_d884fd4c.../blocks/1/payment
```

**4. The daemon returns a receipt**, and only then pulls and starts the container. The
clock starts when the container is ready.

```json
{
  "v": 1,
  "protocol": "bsp/0.1",
  "type": "block_receipt",
  "jobId": "j_d884fd4c-aa55-4347-9988-1dca32fec3e0",
  "blockIndex": 1,
  "providerUaid": "uaid:local:node-a",
  "renterUaid": "uaid:demo:agent",
  "asset": "HBAR",
  "amount": "1500",
  "txId": "0.0.999999@1789236961.955000001",
  "clockStartedAt": "2026-09-12T18:16:01.955Z",
  "boundaryAt": "2026-09-12T18:16:11.955Z"
}
```

**5. Renewal repeats that exchange**, once per block, announced on
`GET /jobs/:id/events` at `boundaryAt - leadSeconds`:

```
block 1  0.0.999999@1789236961.955000001  1500
block 2  0.0.999999@1789236968.337000002  1500
block 3  0.0.999999@1789236978.344000003  1500
declining block 4: max_blocks_reached
Ended: unpaid_boundary after 3 blocks, spent 4500
```

**6. The renter stops buying, and the job ends at the boundary.** Declining is the whole
of the kill switch — no cancel message is sent. The daemon's watchdog does the rest:
`SIGTERM`, a non-billable 5-second grace, `SIGKILL` (container exit code 137), flush
artifacts, emit the terminal receipt. Artifacts from paid blocks are delivered even
though the job ended `expired`:

```
GET http://127.0.0.1:8080/jobs/j_d884fd4c.../artifacts
{ "status": "expired", "artifacts": { "stdout": "work 0\nwork 1\n…work 25\n", "stderr": "" } }
```

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

What is built and tested, and what is not. **319 tests** across ten packages;
`pnpm -r build && pnpm -r test`.

| Built and tested | Not built |
|---|---|
| The block clock: every SPEC §7 row, against a fake clock | **A live settlement on Hedera testnet.** Needs a funded ECDSA account |
| Provider daemon: lifecycle, watchdog, §5.5 termination order, SQLite crash recovery | Deployment: no live URLs, no uptime checks, no systemd units in service |
| Docker executor with memory, CPU, PID, network and read-only-rootfs caps | Demo video |
| Renewal challenge on SSE + the block resource; `402`/`409`/`410`/`425`/duplicate-`200` | HTS settlement token and custom fee (cut list item 4) |
| Registry with liveness, §4.1 rejection, job broker that never proxies payment | HCS-14 UAIDs (cut list item 3) — receipts carry plain string uaids today |
| Renter SDK: renewal loop, budget cap, backoff, stream reconnect, timer fallback | Hardware attestation — out of scope by SPEC §9, and the benchmark says `selfReported: true` |
| Agent: selection on price × block size, cost per unit of work | Provider reputation, slashing, dispute resolution, cross-provider migration |
| Console: the meter, live against a job's event stream | Job history screen (cut list item 5) |
| Receipt schema, canonical signing bytes, HCS publish and mirror-node read | Multi-agent negotiation — deliberately skipped |
| The trust-boundary test: control plane killed mid-job, job keeps billing | |

### What the Phase 0 gate blocks

`docs/facilitator-contract.md` records the facilitator's `/supported` and `402` legs as
**observed**, and its `/verify` and `/settle` legs as **predicted from documentation**.
One thing found there matters and is not yet reconciled:

> The facilitator speaks **x402 v2** — `amount`, not v1's `maxAmountRequired`;
> `hedera:testnet`, not `hedera-testnet`; HBAR as asset `0.0.0`; and a mandatory
> `extra.feePayer` naming the facilitator's co-signer.

`packages/protocol` implements SPEC §6.1's v1 envelope. Rather than change the protocol
document on an unverified reading, the translation lives at the boundary in
`packages/daemon/src/payments/blocky402-client.ts`, which is written and unit-tested but
**has never spoken to the real facilitator**. Confirming it, measuring the round trip, and
checking the §4.1 lead-time floor against that measurement are the remaining Phase 0 work.

To close it: fund an ECDSA testnet account at [portal.hedera.com](https://portal.hedera.com)
and [faucet.hedera.com](https://faucet.hedera.com), put it in `.env`, and run
`pnpm --filter @bsp/phase0-spike server` and `pnpm --filter @bsp/phase0-spike pay`.

## Track requirements

Hedera AI & Agentic Payments track, mapped to where each line is satisfied.

| Requirement | Where | State |
|---|---|---|
| x402-gated service settled through Blocky402 | `packages/daemon/src/payments/blocky402-client.ts`, `src/routes/blocks.route.ts` | Written, not yet run against testnet |
| An agent consuming it, one real paid request end to end | `packages/agent`, `tools/e2e/test/agent.e2e.test.ts` | Works against the mock facilitator |
| Public repo with setup, architecture, payment flow | This file | Done |
| Video ≤5 minutes | — | Not recorded |
| Compute metering rather than flat per-request | `packages/core/src/clock.ts`, `packages/daemon/src/jobs/scheduler.ts` | Done |
| Agent discovery | `packages/control-plane` — `GET /machines` | Done |
| Verifiable audit trails on HCS | `packages/hedera/src/{topic,sink,mirror}.ts` | Code done, no live topic |
| Recurring / streamed payments | The block renewal loop — `packages/sdk/src/job.ts` | Done |
| On-chain agent identity (HCS-14 UAID) | — | Not built |
| HTS token or custom fee schedule | — | Not built |
| Multi-agent negotiation | — | Deliberately skipped |

## What's next

- **Close Phase 0**, then correct `docs/facilitator-contract.md` from the live responses
  and reconcile SPEC §6.1's envelope with the v2 wire.
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
