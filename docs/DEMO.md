# Demo script — four minutes

The run itself is 75 seconds: four blocks at 15s, a fifth declined, a website
that dies at the boundary. Everything else is narration over it.

Rehearsed end to end on 13 September 2026.

---

## Before you hit record

**Start everything first.** Nothing below films a service starting up — the
marketplace, the provider node and the console are already running when the
recording begins.

```sh
pnpm install && pnpm -r build
docker build -t tessera-demo-site:latest examples/demo-site
```

Check the renter has HBAR — HCS submits need it, and token creation drains it:

```sh
curl -s "https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10401938" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['balance']['balance']/1e8,'HBAR')"
```

Under ~5 ℏ, top up at [faucet.hedera.com](https://faucet.hedera.com).

```sh
# 1. marketplace
node packages/control-plane/dist/index.js &

# 2. provider node — 15s blocks, 10s window, priced in TESS
PORT=8080 PROVIDER_ID=node-a \
  DEFAULT_BLOCK_SECONDS=15 DEFAULT_LEAD_SECONDS=10 \
  PRICE_PER_BLOCK=25 ASSET=0.0.10518829 \
  PAY_TO=0.0.10507867 PUBLIC_HOST=127.0.0.1 \
  FACILITATOR_MODE=blocky402 FACILITATOR_FEE_PAYER=0.0.7162784 \
  RECEIPT_SINK=local+hcs HCS_RECEIPT_TOPIC_ID=0.0.10507942 \
  HEDERA_NETWORK=testnet \
  HEDERA_OPERATOR_ID=$HEDERA_OPERATOR_ID HEDERA_OPERATOR_KEY=$HEDERA_OPERATOR_KEY \
  CONTROL_PLANE_URL=http://127.0.0.1:8090 NO_NEW_PRIVILEGES=false \
  node packages/daemon/dist/index.js &

# 3. console
VITE_REGISTRY_URL=http://127.0.0.1:8090 VITE_HCS_TOPIC_ID=0.0.10507942 \
  pnpm -F @bsp/console dev
```

**Screen layout.** Terminal on the left, browser on the right. The browser has
two tabs ready: the console, and a blank tab for the rented site. Have HashScan
open in a third.

Terminal font large enough to read on a phone.

---

## 0:00 – 0:15 · The claim

Open on the console, machine listed, nothing running.

> "This is a marketplace for compute where you pay for a container one block at
> a time, before each block runs. Stop paying and it dies at the boundary.
> Here's what that actually looks like."

## 0:15 – 0:40 · The problem

Stay on the console.

> "A container consumes resources continuously, but payment arrives in lumps.
> You either serve on credit and let people drain you, or you take a deposit up
> front and become the thing crypto was supposed to remove. Tessera does
> neither: time is cut into fixed blocks, each one is paid before it begins,
> and the window to buy the next one opens while the current one is still
> running. That lookahead absorbs settlement latency, so nobody extends credit."

## 0:40 – 1:00 · A machine for rent

Point at the listing in the console.

> "This node is advertising 15-second blocks at a quarter of a TESS each —
> that's an HTS token. Block size is per-listing, so it's something renters
> shop on, not something the protocol fixes."

## 1:00 – 2:15 · The run — 75 seconds

```sh
node --env-file=.env tools/e2e/scripts/hosted-site-demo.mjs
```

As `SITE UP` appears, **open that URL in the second browser tab.**

> "Ordinary container image — a static site, nothing in it knows Tessera
> exists. Block one was paid before the image was even pulled."

Switch to the console. It leads with this job: the meter filling, receipts
stamping in, a link to the live site.

Every 15 seconds:

> "Ten seconds before each boundary the provider offers the next block — that's
> the amber. The renter pays while the current block is still running."

Around block 3, paste a transaction id into HashScan.

> "Real transfer, Hedera testnet, renter to provider. The marketplace never
> touches it."

Refresh the site tab once or twice. Still up.

## 2:15 – 2:40 · The kill

```
window for block 5 — DECLINING (max_blocks_reached)
```

> "Budget's done. Watch what the renter does about it — **nothing.** No cancel
> message, no shutdown request. They just stop buying."

Then:

```
SITE DOWN  http://127.0.0.1:32940
```

Refresh the site tab — connection refused. The console strip freezes, the last
block turns red, the banner reads *This site is gone*.

> "The watchdog reached the boundary, saw block five wasn't paid, and stopped.
> Not a second early — a payment could still have landed. Not a second late —
> that's unpaid work."

## 2:40 – 3:20 · The public record

Open `https://hashscan.io/testnet/topic/0.0.10507942`.

> "The renter doesn't have to take the provider's word for any of this. Every
> block receipt goes to Hedera's consensus service — job, block number, amount,
> transaction, clock start, boundary — plus a final message saying why it
> ended. A billing history anyone can audit."

Open `https://hashscan.io/testnet/token/0.0.10518829`.

> "Blocks are priced in an HTS token with a fractional custom fee, which is
> where a marketplace's cut comes from. On the ledger, not in a slide."

## 3:20 – 4:00 · Close

> "Four blocks bought, one declined, a website that existed for exactly as long
> as it was paid for. The provider never computed on credit. The renter never
> risked more than one block. And the marketplace never touched the money — we
> kill it mid-job in a test and the job keeps running and keeps billing.
>
> What's not done: it isn't deployed anywhere public, there's one node rather
> than two, and identities are plain strings rather than HCS-14. The settlement
> is real."

---

## Timing

| | |
|---|---|
| Block | 15s |
| Renewal window | 10s |
| Blocks bought | 4 |
| Run, rent → site down | **75s** |
| Observed settle time | ~6s, leaving 4s of window unused |

Do **not** shorten the window below 10s for a recording. The facilitator's paid
leg measures ~3.2s and the daemon's verify-then-settle ~4.8s; at an 8s window
one renewal took 7 seconds, which is one hiccup away from killing the job on
camera. Ten seconds has held every time.

Shortening the *block* below 15s is fine and saves a few seconds, but the window
must stay under it.

## If something goes wrong

| Symptom | Cause |
|---|---|
| Containers exit instantly, `exec /bin/sh: operation not permitted` | Docker's `no-new-privileges` on this kernel. `NO_NEW_PRIVILEGES=false`. |
| Daemon dies at startup with an empty log | ssh2's native bindings segfault. Don't build them — see `pnpm-workspace.yaml`. |
| `INSUFFICIENT_PAYER_BALANCE` | Renter is out of HBAR. Faucet. |
| Payment rejected, amount mismatch | `PAY_TO` equals the payer. They must be different accounts. |
| Registry shows no machines | Daemon started before the control plane, or `CONTROL_PLANE_URL` unset. |

**Record three times and keep the cleanest.** The facilitator is a third party
and testnet is testnet — keep a good take as backup before you need one.
