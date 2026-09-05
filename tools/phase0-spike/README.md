# Phase 0 spike (throwaway — not part of the protocol)

Proves one real x402 payment on Hedera testnet through the Blocky402
facilitator. Nothing here ships; Phase 3 rewires the real facilitator
using `docs/facilitator-contract.md`.

## 1. Accounts (once)

1. Create **one ECDSA account** at https://portal.hedera.com (testnet).
   A second payer account is optional — the spike pays operator → receiver,
   which defaults to the operator itself.
2. Fund it at https://faucet.hedera.com (a few testnet HBAR covers dozens
   of 0.001-HBAR spike payments plus fees).
3. HBAR needs no token association. No USDC / Circle faucet needed.

## 2. Env

```sh
cp .env.example .env
# fill HEDERA_OPERATOR_ID=0.0.xxxxxx and HEDERA_OPERATOR_KEY=0x…
```

Optional overrides: `PAYER_ID` / `PAYER_KEY` (separate payer),
`SPIKE_RECEIVER` (separate receiver), `SPIKE_PORT` (default 4029),
`FACILITATOR_URL` (default `https://api.testnet.blocky402.com`).

## 3. Run

```sh
# terminal 1
pnpm --filter @bsp/phase0-spike server
# terminal 2
pnpm --filter @bsp/phase0-spike pay
```

Expected: `[1] 200`, `[2] 402`, `[3] 200` with a `txId` and a
`hashscan.io/testnet` link. Paste that link into
`docs/facilitator-contract.md` (§Observed round trip) — that paste
**is** the Phase 0 gate.

## 4. Timing note

`pay.mjs` prints the paid-leg round trip (402 → sign → verify → settle →
200). That number is the empirical input to SPEC §4.1's lead-time floor:
a 4s window must comfortably fit several attempts of it.
