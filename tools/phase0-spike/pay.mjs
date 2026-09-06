// Phase 0 spike — THROWAWAY payer script.
// 1. GET /health (free). 2. GET /hello raw (expect 402). 3. GET /hello with
// x402 payment wrapper (402 → sign → retry → 200). Prints the settlement
// txId, a HashScan link, and the paid-leg round-trip time — the number that
// justifies SPEC §4.1's lead-time floor.
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { x402HTTPClient } from '@x402/core/client';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import { createClientHederaSigner, PrivateKey } from '@x402/hedera';

const BASE = process.env.SPIKE_BASE ?? `http://localhost:${process.env.SPIKE_PORT ?? '4029'}`;
const PAYER_ID = process.env.PAYER_ID ?? process.env.HEDERA_OPERATOR_ID;
const PAYER_KEY = process.env.PAYER_KEY ?? process.env.HEDERA_OPERATOR_KEY;

if (!PAYER_ID || !PAYER_KEY || PAYER_KEY.length < 10) {
  console.error('✗ Set HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY in .env (see .env.example)');
  process.exit(1);
}

// NOTE: PrivateKey comes from @x402/hedera's re-export (its bundled SDK),
// not the top-level @hiero-ledger/sdk — the signer and TransferTransaction
// are built from that same bundled copy, so the key class must match it.
const signer = createClientHederaSigner(
  PAYER_ID,
  PrivateKey.fromStringECDSA(PAYER_KEY),
  { network: 'hedera:testnet' },
);
const client = new x402Client().register('hedera:testnet', new ExactHederaScheme(signer));
const httpClient = new x402HTTPClient(client);
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const hscan = (txId) => `https://hashscan.io/testnet/transaction/${txId}`;

// 1. Free route — proves the server is up without spending.
const health = await fetch(`${BASE}/health`);
console.log(`[1] GET /health → ${health.status}`, await health.json());

// 2. Raw route — expect 402 with payment requirements.
const raw = await fetch(`${BASE}/hello`);
console.log(`[2] GET /hello (no payment) → ${raw.status}`);
if (raw.status === 402) {
  const body = await raw.json();
  const accept = body?.accepts?.[0];
  console.log(
    '    402 accepts:',
    JSON.stringify({
      scheme: accept?.scheme,
      network: accept?.network,
      asset: accept?.asset,
      payTo: accept?.payTo,
      amount: accept?.maxAmountRequired ?? accept?.amount,
    }),
  );
} else {
  console.error('    ✗ expected 402 — is the payment middleware mounted?');
  process.exit(1);
}

// 3. Paid route — measures the leg that matters for the lead-time floor.
const t0 = Date.now();
const paid = await fetchWithPayment(`${BASE}/hello`);
const paidMs = Date.now() - t0;
console.log(`[3] GET /hello (x402) → ${paid.status} in ${paidMs}ms`);
if (!paid.ok) {
  console.error('    ✗ payment failed:', (await paid.text()).slice(0, 500));
  process.exit(1);
}
console.log('    body:', await paid.json());

let txId;
try {
  const settle = httpClient.getPaymentSettleResponse((name) => paid.headers.get(name));
  txId = settle?.transaction;
} catch { /* fall through to header dump */ }
if (!txId) {
  console.log('    (no decoded settlement; response headers:)');
  paid.headers.forEach((v, k) => {
    if (/pay|settle/i.test(k)) console.log(`    ${k}: ${v.slice(0, 120)}`);
  });
} else {
  console.log(`    txId: ${txId}`);
  console.log(`    HashScan: ${hscan(txId)}`);
}
console.log(`\npaid-leg round trip: ${paidMs}ms (402 → sign → verify → settle → 200)`);
