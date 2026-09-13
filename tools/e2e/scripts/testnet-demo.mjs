/**
 * A real BSP job, settling real blocks on Hedera testnet.
 *
 * Renter and provider are different accounts (a payTo equal to the payer nets
 * to zero and the facilitator rejects it). Every block is a real transfer,
 * verified and settled through Blocky402, with a receipt published to HCS.
 */
import { Marketplace, HederaPayer } from '@bsp/sdk';

const REGISTRY = process.env.REGISTRY_URL ?? 'http://127.0.0.1:8090';
const FEE_PAYER = process.env.FACILITATOR_FEE_PAYER ?? '0.0.7162784';
const BLOCKS = Number(process.env.DEMO_BLOCKS ?? 3);
const PRICE = process.env.PRICE_PER_BLOCK ?? '100000';

const payer = new HederaPayer({
  accountId: process.env.PAYER_ID,
  privateKey: process.env.PAYER_KEY,
  network: 'hedera:testnet',
  feePayer: FEE_PAYER,
  maxAmountPerPayment: '10000000', // 0.1 HBAR ceiling per block
});

const marketplace = new Marketplace({
  registryUrl: REGISTRY,
  renterUaid: `uaid:testnet:${process.env.PAYER_ID}`,
  payer,
});

const machines = await marketplace.machines();
console.log('machines:', machines.map((m) => `${m.machineId} (${m.params.blockSeconds}s @ ${m.params.pricePerBlock})`).join(', '));
if (machines.length === 0) throw new Error('no machines listed — is the daemon running?');

const budget = (BigInt(PRICE) * BigInt(BLOCKS)).toString();
console.log(`\nrenting ${machines[0].machineId}, budget ${budget} tinybars (${BLOCKS} blocks)\n`);

const job = await marketplace.rent({
  machine: machines[0].machineId,
  image: 'busybox:latest',
  cmd: ['sh', '-c', 'i=0; while true; do echo "work $i"; i=$((i+1)); sleep 1; done'],
  budget,
  maxBlocks: BLOCKS,
  fallbackIntervalMs: 500,
});

console.log('job:', job.id);
job.on('block', (b) => console.log(`  ✓ block ${b.index} SETTLED ON TESTNET  ${b.txId}`));
job.on('renewal', (r) => console.log(`  … window for block ${r.index} (${(r.msLeft / 1000).toFixed(1)}s left) → ${r.willPay ? 'paying' : `declining: ${r.reason}`}`));
job.on('error', (e) => console.log('  ! ', e.message));

const result = await job.result();

console.log('\n─── result ───');
console.log('ended      :', result.reason);
console.log('blocks paid:', result.blocksPaid);
console.log('spent      :', result.spent, 'tinybars');
console.log('\nreceipts (each a real Hedera transaction):');
for (const r of result.receipts) {
  console.log(`  block ${r.blockIndex}  ${r.txId}`);
  console.log(`    https://hashscan.io/testnet/transaction/${r.txId}`);
}
