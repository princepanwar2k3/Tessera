# Demo — script and run sheet

Read **The pitch** first; it is what you say. **The run sheet** is what you type.

Two terminals, two browser tabs. Four minutes.

---

## The pitch

> **Tessera is a marketplace where you rent a computer by the block, and pay
> for each block *before* it runs.**
>
> Here is the problem it solves. If you rent compute from someone you don't
> know, one of you has to go first. Either the provider serves you on credit
> and hopes you pay — and an agent can drain them and vanish — or you pay a
> deposit up front and hope they deliver, which is the escrow model that
> crypto payments were supposed to make unnecessary. Somebody is always
> exposed.
>
> Tessera cuts time into fixed blocks — say fifteen seconds. Every block is
> paid for before it runs. And while the current block is still running, the
> provider opens a window to buy the next one. That lookahead is the whole
> trick: it absorbs the few seconds a payment takes to settle, so service is
> continuous while neither side ever extends credit.
>
> Four things fall out of that, and they're the whole design:
>
> **The provider never works unpaid.** The block being served is always
> already settled.
>
> **The renter can lose at most one block.** If the provider vanishes
> mid-block, that's the exposure. Fifteen seconds of compute.
>
> **It ends predictably.** Stop paying and the container stops at the next
> boundary. Not early — a payment might still land. Not late — that would be
> unpaid work. There is no grace period and no negotiation.
>
> **Nobody takes custody.** Payment goes renter to provider directly. Our
> marketplace does discovery and placement, then gets out of the way. We kill
> it mid-job in our test suite and the job keeps running and keeps billing.
>
> Everything you're about to see is real. Real payments on Hedera testnet,
> settled through the Blocky402 x402 facilitator, in an HTS token we minted,
> with every receipt published to Hedera's consensus service where anyone can
> audit it.

Then run it.

### Closing, after the site dies

> Ten blocks bought, the eleventh refused because the renter's wallet was
> empty, and a website that existed for exactly as long as it was paid for.
>
> What's here: block-metered billing rather than flat per-request, an HTS
> settlement token with a custom fee, agent discovery through the registry, an
> audit trail on Hedera's consensus service, HCS-14 identities on every
> receipt, and the renewal loop, which is a streaming payment.
>
> What isn't: it's not deployed to a public URL, there's one provider node
> rather than two, and we deliberately skipped multi-agent negotiation. The
> settlement is real; the marketing is not.

---

## Before you record

Nothing below is filmed. Run it all first, in this order.

### 1. Build once

```sh
cd ~/workspace/tessera
pnpm install && pnpm -r build
docker build -t tessera-demo-site:latest examples/demo-site
```

### 2. Reset anything already running

```sh
bash scripts/reset.sh
```

Stale processes are the most common way a take goes wrong, and they are not
obvious: an old registry holding `:8090` makes the new one die with
`EADDRINUSE`, and the only symptom is the console reporting "no consensus
topic configured" — which looks like a config bug and is not one.

The script stops every Tessera process, force-kills anything still holding a
port after `SIGTERM`, drops rented containers, clears the registry database,
and prints the port state so you can see it worked. Run it between takes.

### 3. Fund the renter — run before EVERY take

The previous take spends it. Without this the job ends at block 1.

```sh
node --env-file=.env tools/e2e/scripts/set-renter-blocks.mjs 10
```

Check HBAR too — HCS submits need it. Under ~5 ℏ, use
[faucet.hedera.com](https://faucet.hedera.com):

```sh
curl -s "https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10401938" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['balance']['balance']/1e8,'HBAR')"
```

### 4. Start the marketplace

```sh
CONTROL_PLANE_PORT=8090 \
HCS_RECEIPT_TOPIC_ID=0.0.10507942 \
  node packages/control-plane/dist/index.js
```

Verify it took the topic — `receiptsConfigured` must be `true`:

```sh
curl -s 127.0.0.1:8090/healthz
```

### 5. Start the renter agent

Holds the key, so the console can rent without one. Only needed if you plan to
rent from the UI rather than the terminal.

```sh
set -a; . ./.env; set +a
RENTER_PORT=8091 REGISTRY_URL=http://127.0.0.1:8090 \
FACILITATOR_FEE_PAYER=0.0.7162784 HTS_SETTLEMENT_TOKEN_ID=0.0.10518829 \
  node packages/renter/dist/index.js
```

### 6. Start the console

`--strictPort` so it fails loudly instead of drifting to another port while
you are not looking.

```sh
VITE_REGISTRY_URL=http://127.0.0.1:8090 \
VITE_HCS_TOPIC_ID=0.0.10507942 \
VITE_HEDERA_NETWORK=testnet \
VITE_SETTLEMENT_TOKEN_ID=0.0.10518829 \
VITE_SETTLEMENT_TOKEN_SYMBOL=TESS \
  pnpm -F @bsp/console exec vite --port 5180 --host 127.0.0.1 --strictPort
```

Open **http://127.0.0.1:5180**. With nothing listed it should say *No machines
listed* — that is the correct starting state.

The marketplace page stays the marketplace: machines, and the jobs running on
them. A renter's own meter lives at `#/renter/<account>`, which the `rent`
command prints, and which the "Paying as …" chip links to.

**Layout.** Terminal 1 (provider) and Terminal 2 (renter) side by side on the
left. Browser on the right with two tabs: the console, and a blank one for the
rented site. Terminal font large enough to read on a phone.

## The run sheet

### 0:00 — The pitch

Static console on screen. Deliver the pitch above. No typing.

### 0:50 — Terminal 1: a provider lists a machine

Terminal 1:

```sh
set -a; . ./.env; set +a

PAY_TO=0.0.10507867 PUBLIC_HOST=127.0.0.1 NETWORK=hedera-testnet \
FACILITATOR_MODE=blocky402 FACILITATOR_FEE_PAYER=0.0.7162784 \
RECEIPT_SINK=local+hcs HCS_RECEIPT_TOPIC_ID=0.0.10507942 \
HEDERA_NETWORK=testnet HTS_SETTLEMENT_TOKEN_ID=0.0.10518829 \
CONTROL_PLANE_URL=http://127.0.0.1:8090 NO_NEW_PRIVILEGES=false \
  node packages/renter/dist/provider-cli.js list \
    --name node-a --block-seconds 15 --lead 10 --price 25 --asset TESS
```

```
  Listing node-a
    block size      15s   what a renter buys at a time
    renewal window  10s   how long they have to buy the next one
    price           25 TESS  per block
```

> "Someone with a spare machine decides what to sell and how finely to slice
> it. Fifteen-second blocks, a ten-second window to renew, a quarter of a TESS
> a block. Block size is per-listing, so it's something renters shop on — the
> protocol doesn't fix it."

Point at the HCS-14 line in the log.

> "It mints itself an HCS-14 identity derived from its own metadata and the
> account it's paid into. Every receipt it signs carries that."

### 1:20 — Terminal 2: a renter goes shopping

Terminal 2:

```sh
node --env-file=.env packages/renter/dist/cli.js machines
```

```
MACHINE   BLOCK   PRICE/BLOCK   WINDOW   HARDWARE        STATUS
node-a    15s     25 TESS       10s      12 vCPU 31GB    online

You hold 250 TESS — 10 blocks, about 2.5 min on node-a.
```

> "The renter sees what's listed and what they can afford. Ten blocks. Note
> that — they're about to ask for twenty."

### 1:40 — Rent it, and host a real site

```sh
node --env-file=.env packages/renter/dist/cli.js rent \
  --machine node-a --image tessera-demo-site:latest --blocks 20
```

Twenty blocks against a ten-block wallet, deliberately — that is what makes it
run out on camera. To rent from the console instead, click **Rent this
machine** on the card; the form quotes the spend cap before anything is paid.

```
  spend cap 500 TESS
  you hold  250 TESS — enough for 10 blocks

  The cap is 20 blocks but you can only pay for 10.
  The site will go down when the money runs out, at block 10.

  Your site is live:  http://127.0.0.1:32943
```

**Open that URL in the browser.**

> "An ordinary container image — a static site, nothing in it knows Tessera
> exists. Block one was paid before the image was even pulled. And it warned
> us up front: the budget says twenty blocks, the wallet says ten."

### 2:00 — The console

Switch to the console tab. It leads with this job.

> "The meter fills as each block is served. Ten seconds before every boundary
> the provider offers the next block — that's the amber, with the countdown.
> The renter pays while the current block is still running."

Point at a receipt, then open one transaction on HashScan.

> "Real transfer on Hedera testnet, renter to provider, in our HTS token. The
> marketplace never touches it."

### 2:40 — It runs out

```
paid    block 10
window  block 11 — paying
error   block 11 refused: ...preflight_failed (usually: not enough of the
        settlement asset to pay for this block)
```

> "The wallet is empty. The renter tries, the facilitator refuses, they retry
> inside the window and it still fails."

Then, at the boundary — switch to the site tab and refresh:

> "Connection refused. The watchdog reached the boundary, saw block eleven
> wasn't paid, and stopped serving. The console freezes the meter, the last
> block turns red, and the banner says the site is gone."

### 3:10 — Hedera's immutable log

Scroll to **On the consensus log** in the console.

> "This table isn't our database. It's read back from Hedera's consensus
> service through a mirror node — every block, the amount, the transaction,
> and the HCS-14 identity that signed it. Anyone can check what this provider
> billed without asking the provider. That's what makes shortening blocks
> detectable rather than deniable."

Open the topic on HashScan for one beat.

### 3:30 — Close

Deliver the closing above.

---

## Where each Hedera track item shows up

| Track item | Where it appears on camera |
|---|---|
| x402 service settled through Blocky402 | every `paid` line — the facilitator co-signs and submits |
| An agent consuming it, real paid request | Terminal 2, blocks 1–10 |
| Compute metering, not flat per-request | the meter; you buy 15-second blocks |
| HTS token / custom fee | priced in TESS `0.0.10518829`, 2% fractional fee |
| Verifiable audit trail on HCS | **On the consensus log** panel, topic `0.0.10507942` |
| On-chain agent identity (HCS-14) | provider startup line, and the *Signed by* column |
| Agent discovery | `tessera machines` reads the registry |
| Recurring / streamed payments | the renewal loop — one payment per block |

Not shown, deliberately: multi-agent negotiation (skipped), a second node, and
a public deployment.

## Identifiers

| | |
|---|---|
| Renter | `0.0.10401938` |
| Provider | `0.0.10507867` |
| HCS receipt topic | `0.0.10507942` |
| HTS token | `0.0.10518829` (TESS, 2dp, 2% fee) |
| Facilitator | `https://api.testnet.blocky402.com` |

## Timing

| | |
|---|---|
| Block | 15s |
| Renewal window | 10s |
| Blocks affordable | 10 |
| Rent → site down | **~155s** |

Ten blocks is about 2.5 minutes of run. If you need it tighter, use
`set-renter-blocks.mjs 6` and the run drops to ~95s — the narration is the same.

Do **not** shorten the window below 10s. The facilitator's paid leg measures
~3.2s and the daemon's verify-then-settle ~4.8s; at 8s one renewal took 7
seconds, which is one hiccup from killing the job on camera.

## If something goes wrong

| Symptom | Cause |
|---|---|
| Containers exit instantly, `operation not permitted` | Docker's `no-new-privileges` on this kernel. `NO_NEW_PRIVILEGES=false`. |
| Daemon dies at startup, empty log | ssh2's native bindings segfault. Don't build them — see `pnpm-workspace.yaml`. |
| `INSUFFICIENT_PAYER_BALANCE` | Renter is out of **HBAR**. Faucet. |
| Job ends at block 1 | Renter is out of **TESS**. Run `set-renter-blocks.mjs`. |
| Amount mismatch on every payment | `PAY_TO` equals the payer. They must be different accounts. |
| `tessera machines` shows nothing | Daemon started before the control plane, or `CONTROL_PLANE_URL` unset. |

**Record three times and keep the cleanest.** The facilitator is a third party
and testnet is testnet.
