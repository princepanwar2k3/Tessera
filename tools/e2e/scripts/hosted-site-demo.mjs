/**
 * The demo: rent a machine, host a real website on it, stop paying, watch it die.
 *
 * Four blocks are bought and the fifth is declined. The site is polled every
 * second throughout, so the moment it stops answering is visible in the output
 * and lines up with the block boundary — not a second before, not after.
 */
import { Marketplace, HederaPayer } from '@bsp/sdk';

const REGISTRY = process.env.REGISTRY_URL ?? 'http://127.0.0.1:8090';
const FEE_PAYER = process.env.FACILITATOR_FEE_PAYER ?? '0.0.7162784';
const BLOCKS = Number(process.env.DEMO_BLOCKS ?? 4);
const PRICE = process.env.PRICE_PER_BLOCK ?? '100000';
const PORT = 8080;

const IMAGE = process.env.DEMO_IMAGE ?? 'tessera-demo-site:latest';

const payer = new HederaPayer({
  accountId: process.env.PAYER_ID,
  privateKey: process.env.PAYER_KEY,
  network: 'hedera:testnet',
  feePayer: FEE_PAYER,
  maxAmountPerPayment: '10000000',
  // HBAR plus the HTS settlement token, when one is configured. The listing
  // decides which is actually used; this only says what may be signed.
  allowedAssets: ['0.0.0', ...(process.env.HTS_SETTLEMENT_TOKEN_ID ? [process.env.HTS_SETTLEMENT_TOKEN_ID] : [])],
});

const marketplace = new Marketplace({
  registryUrl: REGISTRY,
  renterUaid: `uaid:testnet:${process.env.PAYER_ID}`,
  payer,
});

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (line) => console.log(`[${stamp()}] ${line}`);

const machines = await marketplace.machines({ liveOnly: true });
if (machines.length === 0) throw new Error('no machines listed — is the daemon running?');
const machine = machines[0];
log(`found ${machine.machineId}: ${machine.params.blockSeconds}s blocks @ ${machine.params.pricePerBlock} ${machine.params.asset}`);

const budget = (BigInt(PRICE) * BigInt(BLOCKS)).toString();
log(`renting for ${BLOCKS} blocks (budget ${budget}), image ${IMAGE}`);

const job = await marketplace.rent({
  machine: machine.machineId,
  // A normal container image — examples/demo-site — with nothing in it that
  // knows about Tessera. The provider runs it, publishes its port, and stops
  // it at an unpaid boundary.
  image: IMAGE,
  exposedPort: PORT,
  budget,
  maxBlocks: BLOCKS,
  fallbackIntervalMs: 500,
});

job.on('block', (b) => log(`  BLOCK ${b.index} SETTLED  ${b.txId}`));
job.on('renewal', (r) =>
  log(`  window for block ${r.index} — ${r.willPay ? 'paying' : `DECLINING (${r.reason})`}`),
);

// Poll the rented site until it stops answering.
let lastUp = null;
let wentDownAt = null;
const poll = setInterval(async () => {
  const url = job.serviceUrl ?? job.state?.serviceUrl;
  if (!url) return;
  let up = false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(800) });
    up = res.ok;
  } catch {
    up = false;
  }
  if (up !== lastUp) {
    if (up) log(`  SITE UP    ${url}`);
    else {
      wentDownAt = Date.now();
      log(`  SITE DOWN  ${url}`);
    }
    lastUp = up;
  }
}, 1000);

const result = await job.result();
await new Promise((r) => setTimeout(r, 2500));
clearInterval(poll);

console.log('\n─── what happened ───');
console.log(`site           : ${result.receipts.length ? 'served from the rented container' : 'never started'}`);
console.log(`blocks paid    : ${result.blocksPaid}`);
console.log(`spent          : ${result.spent} (${machine.params.asset})`);
console.log(`ended          : ${result.reason}`);
console.log(`final block    : ${result.finalBlockIndex}`);
if (wentDownAt) console.log(`site went down : at the block ${result.finalBlockIndex} boundary`);
console.log('\nreceipts — each a real Hedera transaction:');
for (const r of result.receipts) {
  console.log(`  block ${r.blockIndex}  https://hashscan.io/testnet/transaction/${r.txId}`);
}
console.log(`\npublic billing history: https://hashscan.io/testnet/topic/${process.env.HCS_RECEIPT_TOPIC_ID ?? '0.0.10507942'}`);
