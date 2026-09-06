# Block Settlement Protocol (BSP) v0.1

A settlement pattern for continuously consumed services, built on x402.

Status: draft · Network: Hedera · Facilitator: Blocky402

---

## 1. Motivation

x402 is request-shaped. One request, one price, one payment, one response, both sides stateless afterward. That works because the unit of value is discrete.

Continuous services have no such unit. A container runs, and resources are consumed the whole time, while payments trail behind. x402 says nothing about the gap between work happening and money arriving, so every implementer invents an answer. The two obvious ones are both bad:

- **Serve on credit, reconcile later.** The provider is exposed for the reconciliation interval. An agent can drain work and disappear.
- **Escrow up front.** The renter is exposed for the whole lease, which is the deposit model that x402 was supposed to make unnecessary.

BSP takes a third path: divide time into fixed blocks, require each block to be paid before it begins, and open the window to buy block *n+1* while block *n* is still running. The lookahead absorbs settlement latency, so continuous service is delivered without either party extending credit.

## 2. Terminology

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119.

| Term | Definition |
|---|---|
| **Provider** | The party delivering the service and receiving payment. |
| **Renter** | The party consuming the service and making payment. |
| **Block** | The atomic unit of service delivery, `block_seconds` long. |
| **Block index** | 1-based ordinal of a block within a job. |
| **Lead time** | `lead_seconds`, how long before a boundary the next block may be purchased. |
| **Renewal window** | The final `lead_seconds` of a block. |
| **Boundary** | The instant a block ends and the next begins. |
| **Clock start** | The instant block 1 begins. Defined in §5.2. |
| **Paid through** | The highest block index for which settlement has confirmed. |
| **Receipt** | A signed record that a block was paid for and served. |

## 3. Invariants

A conforming implementation MUST preserve all four.

**I1 — No credit.** At every instant during service delivery, the block currently being served MUST already be settled. The provider never performs unpaid work.

**I2 — Bounded renter exposure.** The renter's maximum loss from provider failure or non-performance MUST NOT exceed the value of one block.

**I3 — Deterministic termination.** Service MUST terminate at a boundary and MUST NOT terminate between boundaries for non-payment. There is no grace period; the renewal window serves that function.

**I4 — No custody.** Payment MUST transfer directly from renter to provider. No escrow contract, treasury, or third party holds renter funds at any point.

## 4. Parameters

Set per listing by the provider, advertised at discovery, and fixed for the lifetime of a job.

| Parameter | Type | Constraint |
|---|---|---|
| `block_seconds` | integer | 5 ≤ n ≤ 3600 |
| `lead_seconds` | integer | see below |
| `price_per_block` | integer (smallest unit) | > 0 |
| `asset` | token id or `HBAR` | — |

### 4.1 Lead-time floor

A registry MUST reject a listing where:

```
lead_seconds < 4
lead_seconds < ceil(0.3 * block_seconds)
lead_seconds >= block_seconds
```

Rationale: a window shorter than roughly four seconds cannot reliably accommodate facilitator round-trip time, so every job would die at its first boundary. A misconfigured provider must not be able to make the protocol look broken. The upper bound prevents a window that spans the entire block, which would make prepayment meaningless.

### 4.2 Granularity as a market variable

The protocol deliberately does not fix `block_seconds`. Shorter blocks mean less forfeited time on the final block and finer renter control; longer blocks mean fewer settlements and greater tolerance for network trouble. Providers select a point on that curve and renters compare listings on it alongside price and specification.

Reference default: `block_seconds = 30`, `lead_seconds = 10`.

## 5. Job lifecycle

### 5.1 States

```
       ┌──────────────────┐
       │ awaiting_payment │
       └────────┬─────────┘
                │ block 1 settled
       ┌────────▼─────────┐
       │     starting     │   provider pulls image, prepares
       └────────┬─────────┘
                │ service ready  ── clock starts here
       ┌────────▼─────────┐
   ┌───►     running      ├───► completed   (service finished)
   │   └────────┬─────────┘
   │            │ boundary reached, paid_through <= block_index
   │            │
   │   ┌────────▼─────────┐
   │   │     expired      │   terminated for non-renewal
   │   └──────────────────┘
   │
   └── boundary reached, paid_through > block_index
       (block_index++, boundary_at += block_seconds)
```

`aborted` is a terminal state reachable from `running` on provider failure.

### 5.2 Clock start

The block clock MUST start when the service becomes ready to consume, not when payment for block 1 confirms.

Time spent on provisioning — image pull, container creation, cold start — is borne by the provider. A renter who pays for a 30-second block MUST receive 30 seconds of usable service.

Providers SHOULD cache images to keep provisioning short. Providers MAY refuse jobs whose provisioning is expected to exceed a configured limit.

### 5.3 Renewal

At `boundary_at - lead_seconds` the provider MUST make a payment requirement available for block `block_index + 1`, via a renewal challenge on the job's event stream, a `402` on the block resource, or both.

The renter MAY settle at any point between window open and the boundary. A payment confirming at `boundary_at - 0.5s` is as valid as one confirming at window open.

### 5.4 Boundary evaluation

The provider MUST evaluate the boundary condition at or after each `boundary_at`, and MUST NOT evaluate it early.

```
if now >= boundary_at:
    if paid_through > block_index:
        block_index  += 1
        boundary_at  += block_seconds
    else:
        terminate(reason = "unpaid_boundary")
```

Evaluation SHOULD occur within 1 second of the boundary. Implementations MUST NOT terminate before `boundary_at` even when the window has closed with no payment, since a payment may still confirm.

### 5.5 Termination

On termination the provider MUST, in order: signal the service to stop gracefully; allow a shutdown grace period (RECOMMENDED 5 seconds) that is not billable; force-stop if still running; flush and make available any artifacts produced during paid blocks; emit a terminal receipt.

Artifacts from paid blocks MUST be delivered even on `expired` termination. The renter paid for that work.

### 5.6 Early completion

If the service completes before the current block's boundary, the remainder of that block is forfeited and MUST NOT be refunded.

This is a minimum billing increment, consistent with prevailing cloud practice. A renter who wants finer granularity selects a listing with a smaller `block_seconds`.

## 6. Wire format

### 6.1 Payment requirement

Standard x402 with a namespaced extension. A stock x402 client that ignores `blockMeta` still settles correctly.

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "hedera-testnet",
    "asset": "0.0.XXXXXX",
    "payTo": "0.0.PROVIDER",
    "maxAmountRequired": "1500",
    "resource": "https://node-a.example/jobs/{jobId}/blocks/{n}",
    "description": "Block 2 of 30s on node-a",
    "facilitator": "https://facilitator.blocky402.com"
  }],
  "blockMeta": {
    "protocol": "bsp/0.1",
    "jobId": "j_01HQ...",
    "blockIndex": 2,
    "blockSeconds": 30,
    "leadSeconds": 10,
    "clockStartedAt": "2026-09-14T10:00:00.000Z",
    "windowOpensAt":  "2026-09-14T10:00:20.000Z",
    "boundaryAt":     "2026-09-14T10:00:30.000Z"
  }
}
```

All timestamps are RFC 3339 UTC with millisecond precision. Both parties SHOULD treat the provider's clock as authoritative and SHOULD NOT rely on local time for window calculations.

### 6.2 Receipt

Published to the job's HCS topic on every settled block and on termination.

```json
{
  "v": 1,
  "protocol": "bsp/0.1",
  "type": "block_receipt",
  "jobId": "j_01HQ...",
  "blockIndex": 2,
  "providerUaid": "uaid:aid:...",
  "renterUaid": "uaid:aid:...",
  "asset": "0.0.XXXXXX",
  "amount": "1500",
  "txId": "0.0.1234@1757844000.123456789",
  "clockStartedAt": "2026-09-14T10:00:00.000Z",
  "boundaryAt": "2026-09-14T10:00:30.000Z",
  "providerSig": "...",
  "renterSig": "..."
}
```

`type` is one of `block_receipt`, `terminated`, `aborted`. Terminal messages carry `reason` and `finalBlockIndex` and omit payment fields.

Receipts SHOULD carry both signatures. A receipt with only the provider's signature is still valid evidence of a claim, but not of agreement.

### 6.3 Errors

| Code | Condition | Body |
|---|---|---|
| `402` | Payment required for this block | Payment requirement (§6.1) |
| `409` | Out-of-order payment | `{ "error": "out_of_order", "expectedBlockIndex": n }` |
| `410` | Job already terminated | `{ "error": "job_closed", "finalBlockIndex": n, "reason": "..." }` |
| `425` | Window not yet open | `{ "error": "window_closed", "windowOpensAt": "..." }` |
| `200` | Duplicate payment for a settled block | The existing receipt, unchanged |

## 7. Required behaviours

| Case | Requirement |
|---|---|
| Payment confirms inside window, before boundary | MUST accept |
| Payment confirms after boundary | MUST reject `410`. Provider MUST NOT capture the payment. |
| Payment for block `n+2` while `n+1` unpaid | MUST reject `409` with `expectedBlockIndex` |
| Duplicate payment for a settled block | MUST be idempotent: return the existing receipt, MUST NOT double-charge |
| Payment attempt before window opens | SHOULD reject `425`. MAY accept as prepayment if the implementation tracks `paid_through` correctly. |
| Provisioning exceeds one block | Provider MUST absorb it (§5.2) |
| Service exits early | Remaining block forfeited (§5.6) |
| Provider fails mid-block | Renter loses at most that block. Provider MUST emit `aborted` on recovery. |
| Renter disappears | Job terminates at the next boundary. No cleanup handshake required. |
| Facilitator times out during renewal | Renter SHOULD retry within the window. A 10s window permits several attempts. |

## 8. Security considerations

**Provider clock manipulation.** The provider is authoritative on timing and could shorten blocks to bill more often. Receipts carry `clockStartedAt` and `boundaryAt`, so systematic shortening is detectable across a public receipt history. This makes cheating auditable rather than impossible.

**Renewal denial.** A provider could withhold the renewal challenge to force termination while keeping the current block's payment. Exposure is capped at one block by I2. Repeated instances are visible in the receipt log.

**Facilitator trust.** x402 delegates verification and settlement to a facilitator whose correctness is not enforced by the protocol. BSP inherits this. Hedera's deterministic finality removes the reorg class of risk but not facilitator misbehaviour. Renters SHOULD verify settlement against a mirror node independently of the facilitator's confirmation.

**Griefing by provisioning.** Since provisioning is unbilled (§5.2), a renter could repeatedly start jobs with large images and abandon them. Providers SHOULD rate-limit job creation per renter identity and MAY require block 1 payment before provisioning begins, which this specification already mandates.

**Resource isolation.** Providers execute renter-supplied workloads and MUST apply memory, CPU, PID, filesystem, and network limits. Out of scope for this specification, but not optional in practice.

## 9. Out of scope

Hardware attestation, provider reputation and slashing, workload verification, cross-provider migration, price discovery and negotiation, refunds and dispute resolution.

BSP defines settlement for continuous delivery. It does not establish that a provider's advertised capability is truthful, nor that delivered work is correct. Those require separate mechanisms.

## 10. Conformance

An implementation conforms to BSP v0.1 if it preserves I1–I4, implements §5 lifecycle and §7 behaviours, and emits receipts per §6.2.

Publishing receipts to a public consensus log is RECOMMENDED but not required for conformance. Without it, I1 and I2 hold but cannot be independently verified.

---

*Reference implementation: see `/packages/daemon` and `/packages/sdk`.*
