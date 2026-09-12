# Facilitator contract — Blocky402 testnet, Hedera, x402 v2

Source: **observed behaviour** against `https://api.testnet.blocky402.com`,
2026-09-13, using `tools/phase0-spike` with a funded ECDSA testnet account.
The Phase 0 gate is **met**: see §5 for the settled transaction and the
measured round trip.

Wire version: **x402 v2** (`x402Version: 2`). Client/server SDKs:
`@x402/{fetch,express,hedera,core}@2.25.0`, `@hiero-ledger/sdk@^2.87`.
Working-code reference: `hedera-dev/x402-inference-pay-per-request-poc`.

---

## 1. Endpoint base (OBSERVED)

- Testnet: **`https://api.testnet.blocky402.com`** (open access, no API key).
- Live `GET /supported` returns:
  ```json
  {"kinds":[
    {"x402Version":2,"scheme":"exact","network":"eip155:80002"},
    {"x402Version":2,"scheme":"exact","network":"solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
     "extra":{"feePayer":"7B6Q2MvcJvNcy1A13wHmAzmmdo3L8DVriaXML7bvkojm"}},
    {"x402Version":2,"scheme":"exact","network":"hedera:testnet",
     "extra":{"feePayer":"0.0.7162784"}}],
   "extensions":[],
   "signers":{"hedera:*":["0.0.7162784"], …}}
  ```
- The facilitator co-signs as **fee payer** (`0.0.7162784`) and submits the
  transfer; the payer's key only partially signs. Every Hedera requirement
  MUST carry `extra.feePayer` equal to that signer.

## 2. The 402 (OBSERVED)

- Status `402 Payment Required`, **empty JSON body `{}`**.
- The requirement travels in the **`PAYMENT-REQUIRED` response header**,
  base64-encoded JSON:
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
      "payTo": "0.0.10401938",
      "maxTimeoutSeconds": 300,
      "extra": {"feePayer": "0.0.7162784"}
    }]
  }
  ```
- Amount is a **decimal string in tinybars** (`"100000"` = 0.001 HBAR).
- HBAR is `asset: "0.0.0"`; HTS tokens use their `0.0.NNNN` id.
- v2 field is **`amount`**, not v1's `maxAmountRequired`, and the network
  separator is a colon (`hedera:testnet`, not `hedera-testnet`).
  `packages/daemon/src/payments/blocky402-client.ts` translates both.
- Paid retry sends base64 `paymentPayload` JSON in the **`X-PAYMENT` request
  header**; settlement proof comes back in response headers, decoded via
  `x402HTTPClient.getPaymentSettleResponse()`.

## 3. Failures surface in the retry's 402 header (OBSERVED)

A rejected payment returns another `402` with an **empty body**; the reason is
the `error` field of the `PAYMENT-REQUIRED` header on that response. Reading
only the body tells you nothing — this cost real debugging time.

Observed values:

| `error` | Cause |
|---|---|
| `Payment required` | No payment attached (the first, expected 402) |
| `invalid_exact_hedera_payload_amount_mismatch` | The transfer did not match the requirement — see the self-transfer trap below |

**Self-transfer trap.** If `payTo` equals the payer's own account, the transfer
nets to zero and the facilitator rejects it as an amount mismatch. The spike
defaults `SPIKE_RECEIVER` to the operator, so a single-account setup fails with
a message that does not mention the real cause. Provider and renter must be
different accounts — which is also true of any real BSP deployment.

## 4. Client-side gotchas (OBSERVED)

Two things that are easy to get wrong and produce misleading errors:

- **HBAR is not a "default asset".** `@x402/core`'s client spend controls
  reject `asset: "0.0.0"` out of the box with *"All payment requirements were
  rejected by spendControls"*. Opt it in explicitly and keep an atomic cap:
  ```js
  client.setSpendControls({
    allowedAssets: [
      { network: 'hedera:testnet', asset: '0.0.0', maxAmountPerPayment: '1000000' },
    ],
  });
  ```
  Prefer this to `spendControls: false` — the cap is what stops a misread
  requirement from spending real money on mainnet.
- **`new x402Client(...)` takes a requirements *selector*, not a config
  object.** Passing `{ spendControls }` to the constructor is silently
  ignored; use `.setSpendControls()`. The failure looks identical to not
  having configured anything.

## 5. Round trip — the Phase 0 gate (OBSERVED, MET)

One real settlement on `hedera:testnet`, payer `0.0.10401938`:

- **txId** `0.0.7162784@1789239227.007796560`
- **HashScan** https://hashscan.io/testnet/transaction/0.0.7162784@1789239227.007796560
- Mirror node confirms `result: SUCCESS`, `consensus_timestamp
  1789239237.197694225`, transfers `0.0.10401938 -100000`, fee `267793`
  charged to the facilitator.

Note the transaction id is minted under the **facilitator's** account
(`0.0.7162784`), not the payer's, because the facilitator is the fee payer and
submits the transaction. Anything matching receipts to a payer account by
parsing the txId prefix would be wrong.

Mirror-node lookups need the dashed form:
`0.0.7162784-1789239227-007796560`.

### Measured paid-leg time (402 → sign → verify → settle → 200)

| Run | ms |
|---|---|
| 1 | 3670 |
| 2 | 3294 |
| 3 | 3022 |
| 4 | 3090 |
| 5 | 3157 |

**Median ≈ 3.2s, range 3.0–3.7s (n=5, local server, one hop to the
facilitator).**

This replaces SPEC §4.1's assertion with a measurement, and it matters:

- A **4-second** renewal window — the protocol floor — fits **exactly one
  attempt**, with 0.3–1.0s of margin. There is no room to retry.
- A **10-second** window (the reference default) fits **three** attempts, so
  SPEC §7's "a 10s window permits several attempts" holds as measured.
- Therefore the floor stays at 4s as a hard minimum, but any listing that
  wants retry headroom needs **≥ 8s**, and the demo should not be recorded at
  10s/4s. See SPEC §4.1.

## 6. Account setup

- Accounts MUST be **ECDSA** (portal.hedera.com), funded at faucet.hedera.com.
  HBAR needs no association, which is why the spike prices in HBAR.
- You need **two** accounts, or a receiver that is not the payer — see the
  self-transfer trap in §3.
- USDC testnet (`0.0.429274`) would need association on both wallets plus
  faucet.circle.com funds — deferred.

## 7. Reproducing

```sh
# .env: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, PAYER_ID, PAYER_KEY
SPIKE_RECEIVER=0.0.7162784 pnpm --filter @bsp/phase0-spike server   # terminal 1
pnpm --filter @bsp/phase0-spike pay                                  # terminal 2
```
