# Facilitator contract — Blocky402 testnet, Hedera, x402 v2

Source: **observed behaviour**, not documentation. Lines marked
`[PREDICTED — from docs, unconfirmed]` are transcribed from
https://blocky402.com/docs and MUST be corrected against a live run
before Phase 3 wires the real facilitator. Lines marked `[PENDING]`
block the Phase 0 gate.

Wire version: **x402 v2** (`x402Version: 2`). Client/server SDKs:
`@x402/{fetch,express,hedera,core}@^2.25.0`, `@hiero-ledger/sdk@^2.87`.
Working-code reference: `hedera-dev/x402-inference-pay-per-request-poc`
(`packages/service/src/{server,x402}.ts`, `packages/agent/src/x402-client.ts`).

---

## 1. Endpoint base (OBSERVED via live `GET /supported`, 2026-09-05)

- Testnet: **`https://api.testnet.blocky402.com`** (open access, no API key).
  - NOTE: the pre-Phase-0 `.env.example` said `facilitator.blocky402.com` —
    that host is wrong for testnet and was corrected.
- Mainnet: `https://api.blocky402.com` (API key required — out of scope for Phase 0).
- Auth on testnet: none. Rate limit: 100 req/min/IP, burst 10.
- Advertised kinds include exactly:
  ```json
  {"x402Version": 2, "scheme": "exact", "network": "hedera:testnet",
   "extra": {"feePayer": "0.0.7162784"}}
  ```
  with `signers: {"hedera:*": ["0.0.7162784"], …}`.
- The facilitator co-signs as **fee payer** (`0.0.7162784`) and submits the
  transfer; the payer's key only partially signs. Every Hedera payment
  requirement MUST carry `extra.feePayer` equal to the advertised signer —
  `@x402/express` injects this automatically (see §3).

## 2. The 402 (OBSERVED against local spike server, `tools/phase0-spike`)

- Status `402 Payment Required`, **empty JSON body `{}`**.
- The requirement travels in the **`PAYMENT-REQUIRED` response header**:
  base64-encoded JSON of the form:
  ```json
  {
    "x402Version": 2,
    "error": "Payment required",
    "resource": {"url": "…", "description": "…", "mimeType": "application/json"},
    "accepts": [{
      "scheme": "exact",
      "network": "hedera:testnet",
      "amount": "100000",
      "asset": "0.0.0",
      "payTo": "0.0.RECEIVER",
      "maxTimeoutSeconds": 300,
      "extra": {"feePayer": "0.0.7162784"}
    }]
  }
  ```
- Consequences:
  - Amount is a **decimal string in tinybars** (`"100000"` = 0.001 HBAR).
  - HBAR is `asset: "0.0.0"`; HTS tokens use their `0.0.NNNN` id.
  - v2 field is **`amount`**, not v1's `maxAmountRequired` — SPEC §6.1's
    `maxAmountRequired` does not match the v2 wire and must be reconciled
    before Phase 3 (flag, not a change: SPEC §6.1 describes the blockMeta
    extension envelope, the x402 half follows the facilitator).
  - Paid retry sends base64 `paymentPayload` JSON in the **`X-PAYMENT`
    request header** (not v1's `PAYMENT-SIGNATURE`); settlement proof comes
    back in response headers, decoded via
    `x402HTTPClient.getPaymentSettleResponse()`.

## 3. Verify (PREDICTED — from docs, unconfirmed)

- `POST {base}/verify`, `Content-Type: application/json`, body:
  ```json
  {"x402Version": 2, "paymentPayload": {"x402Version": 2, "scheme": "exact",
    "network": "hedera:testnet", "accepted": {…requirements…},
    "payload": {"transaction": "<base64-TransferTransaction>"}},
   "paymentRequirements": {…requirements…}}
  ```
- Success shape: `{"isValid": true, "payer": "<0.0.xxxx>"}` (exact extra
  keys TBD — record them from the live run).
- Failure shape: `isValid: false` with `invalidMessage`/`invalidReason`
  (exact key TBD — record it).

## 4. Settle (PREDICTED — from docs, unconfirmed)

- `POST {base}/settle`, same body as verify.
- Success shape: `{"success": true, "transaction": "0.0.7162784@…",
  "network": "hedera:testnet"}` (exact keys TBD — record them).
- Failure shape: `{"success": false, "errorMessage"/"errorReason": "…"}` TBD.
- Duplicate settle: [PENDING — observe: settle the same payload twice and
  record whether the second call returns the original tx, errors, or
  double-spends. Phase 3's §6.3 idempotency depends on this answer.]

## 5. Round trip (PENDING — the Phase 0 gate)

- [PENDING] One real settlement on hedera:testnet via the spike
  (`tools/phase0-spike`: `pnpm --filter @bsp/phase0-spike server` +
  `pnpm --filter @bsp/phase0-spike pay` with funded testnet ECDSA creds).
- [PENDING] HashScan link: `https://hashscan.io/testnet/transaction/<txId>`
- [PENDING] Paid-leg wall time (402 → sign → verify → settle → 200) as
  printed by `pay.mjs`. SPEC §4.1's rationale asserts a ~4s window fits
  facilitator round trips; replace the assertion with this measurement.
  If it exceeds ~2s, raise the reference default per the plan's fallback.
- [PENDING] Correct §§3–4 against the live responses (error keys,
  duplicate behaviour, timeout shape).

## 6. Account setup (from the PoC's SETUP, not yet executed here)

- Accounts MUST be **ECDSA** (portal.hedera.com), funded via
  faucet.hedera.com. HBAR needs no association and no Circle faucet —
  that is why the spike prices in HBAR (0.001 HBAR).
- USDC testnet (`0.0.429274`) would require token association on both
  wallets plus faucet.circle.com funds — deferred to Phase 6's HTS work.
