# Demo script

A nine-minute run-through that ends with a website dying at a block boundary,
on camera, with every payment checkable on HashScan.

Everything below was rehearsed end to end on 13 September 2026.

---

## Before you start

| | |
|---|---|
| Renter account | `0.0.10401938` — needs HBAR for HCS fees, and TESS to spend |
| Provider account | `0.0.10507867` — receives block payments |
| HCS receipt topic | `0.0.10507942` |
| HTS settlement token | `0.0.10518829` (TESS, 2 decimals) |
| Facilitator | `https://api.testnet.blocky402.com` |

Check the renter has HBAR left — token creation drains it fast, and HCS
submits need it:

```sh
curl -s "https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10401938" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['balance']['balance']/1e8,'HBAR')"
```

Under ~5 HBAR, top up at [faucet.hedera.com](https://faucet.hedera.com) first.

Build once, and build the renter's site image:

```sh
pnpm install && pnpm -r build
docker build -t tessera-demo-site:latest examples/demo-site
```

Have four things open: a terminal, the console, a browser tab for the rented
site, and HashScan.

---

## 1 · Start the marketplace (30s)

> "This is the marketplace. It does discovery and placement, and nothing else —
> it never touches a payment."

```sh
node packages/control-plane/dist/index.js
```

---

## 2 · Register a machine (1m)

> "This is a provider. Someone with a spare box runs this, and it advertises
> what it will sell: 20-second blocks, 0.25 TESS a block."

```sh
PORT=8080 PROVIDER_ID=node-a \
  DEFAULT_BLOCK_SECONDS=20 DEFAULT_LEAD_SECONDS=8 \
  PRICE_PER_BLOCK=25 ASSET=0.0.10518829 \
  PAY_TO=0.0.10507867 PUBLIC_HOST=127.0.0.1 \
  FACILITATOR_MODE=blocky402 FACILITATOR_FEE_PAYER=0.0.7162784 \
  RECEIPT_SINK=local+hcs HCS_RECEIPT_TOPIC_ID=0.0.10507942 \
  HEDERA_NETWORK=testnet \
  HEDERA_OPERATOR_ID=$HEDERA_OPERATOR_ID HEDERA_OPERATOR_KEY=$HEDERA_OPERATOR_KEY \
  CONTROL_PLANE_URL=http://127.0.0.1:8090 \
  NO_NEW_PRIVILEGES=false \
  node packages/daemon/dist/index.js
```

Show it appearing in the registry:

```sh
curl -s http://127.0.0.1:8090/machines | python3 -m json.tool
```

> "It registered itself, and the registry checked its listing against the
> protocol's lead-time floor before accepting it. A provider can't advertise a
> renewal window too short to pay inside."

Start the console and show the machine listed:

```sh
VITE_REGISTRY_URL=http://127.0.0.1:8090 \
VITE_HCS_TOPIC_ID=0.0.10507942 \
  pnpm -F @bsp/console dev
```

---

## 3 · Rent it and host a website (2m)

> "Now a renter. This is an ordinary container image — a static site, nothing
> in it knows what Tessera is. They're buying four blocks."

```sh
node --env-file=.env tools/e2e/scripts/hosted-site-demo.mjs
```

The first lines to point at:

```
found node-a: 20s blocks @ 25 0.0.10518829
renting for 4 blocks (budget 100), image tessera-demo-site:latest
  SITE UP    http://127.0.0.1:32938
```

**Open that URL in the browser.** The site is live.

> "Block one was paid before the container was even pulled. The provider never
> runs anything it hasn't been paid for."

Switch to the console. The landing page leads with this job: the meter filling,
the receipts stamping in, a link to the site.

---

## 4 · Watch it renew (2m)

Every twenty seconds:

```
  window for block 2 — paying
  BLOCK 2 SETTLED  0.0.7162784@1789279671.374666933
```

> "Eight seconds before the boundary the provider offers the next block, and
> the renter pays for it while the current one is still running. That lookahead
> is the whole trick — it absorbs settlement latency, so neither side is ever
> extending credit."

In the console, the current block outlines **amber** with a countdown. Amber
appears only while a window is open.

Paste a transaction id into HashScan:

> "That's a real transfer on Hedera testnet. Twenty-five hundredths of a TESS
> from the renter to the provider, settled through the Blocky402 facilitator."

Keep refreshing the rented site. It stays up.

---

## 5 · Stop paying (2m) — the moment

```
  window for block 5 — DECLINING (max_blocks_reached)
```

> "The renter's budget is done. Watch what they do about it: **nothing**.
> There's no cancel message, no shutdown request. They just stop buying."

Now watch the site. At the block-4 boundary:

```
  SITE DOWN  http://127.0.0.1:32938
```

Refresh the browser tab — connection refused.

> "The provider's watchdog evaluated the boundary, saw block five wasn't paid,
> and stopped serving. Not a second early — a payment could still have landed.
> Not a second late — that would be unpaid work."

In the console, the strip freezes and the final block turns red. The site
banner switches to *This site is gone*, with the URL struck through.

---

## 6 · The public record (1m)

> "The renter doesn't have to take the provider's word for any of this."

Open the topic:

```
https://hashscan.io/testnet/topic/0.0.10507942
```

> "Every block receipt is on Hedera's consensus service — the job, the block
> number, the amount, the transaction, the clock start and the boundary. Plus
> a final message saying why it ended. That's a billing history anyone can
> audit, and it's what makes a provider quietly shortening blocks detectable
> rather than just deniable."

Show the token:

```
https://hashscan.io/testnet/token/0.0.10518829
```

> "Blocks are priced in an HTS token, not HBAR. It carries a fractional custom
> fee, which is where a marketplace's cut would come from — on the ledger,
> not in a slide."

---

## 7 · Close (30s)

> "Four blocks bought, one declined, a website that existed for exactly as long
> as it was paid for. The provider never computed on credit, the renter never
> risked more than one block, and the marketplace never touched the money — we
> killed it mid-job in a test and the job kept running and kept billing."

---

## Timing

At 20s blocks a four-block run is about 100 seconds. Tighten to `12`/`8` if you
want a faster meter — that is the shortest configuration the measured 3.2s
facilitator round trip still leaves room to retry inside. Do **not** use 10s/4s:
a 4s window fits one attempt and no retry, and a single hiccup kills the job on
camera.

## If something goes wrong

| Symptom | Cause |
|---|---|
| Containers exit instantly, `exec /bin/sh: operation not permitted` | Docker's `no-new-privileges` on this kernel. `NO_NEW_PRIVILEGES=false`. |
| Daemon dies at startup with an empty log | ssh2's native bindings segfault. Don't build them — see `pnpm-workspace.yaml`. |
| `INSUFFICIENT_PAYER_BALANCE` | Renter is out of HBAR. Faucet. |
| Payment rejected, amount mismatch | `PAY_TO` equals the payer. They must be different accounts. |
| Registry shows no machines | Daemon started before the control plane, or `CONTROL_PLANE_URL` unset. |

Have a recording of a clean run as backup. The facilitator is a third party and
testnet is testnet.
