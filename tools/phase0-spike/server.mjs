// Phase 0 spike — THROWAWAY resource server.
// GET /hello returns 402 (0.001 HBAR on hedera:testnet, via Blocky402);
// a client that pays gets 200. Adapted from the working pattern in
// hedera-dev/x402-inference-pay-per-request-poc (packages/service).
import express from 'express';
import { paymentMiddleware } from '@x402/express';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactHederaScheme } from '@x402/hedera/exact/server';

const PORT = Number(process.env.SPIKE_PORT ?? '4029');
const OPERATOR_ID = process.env.HEDERA_OPERATOR_ID;
const RECEIVER = process.env.SPIKE_RECEIVER ?? OPERATOR_ID;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'https://api.testnet.blocky402.com';

if (!OPERATOR_ID || OPERATOR_ID.includes('X')) {
  console.error('✗ Set HEDERA_OPERATOR_ID in .env (see .env.example)');
  process.exit(1);
}

// 0.001 HBAR = 100,000 tinybars. HBAR needs no token association.
const HBAR_PRICE = { asset: '0.0.0', amount: '100000' };

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  'hedera:*',
  new ExactHederaScheme({}),
);

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', facilitator: FACILITATOR_URL, receiver: RECEIVER });
});

app.use(
  paymentMiddleware(
    {
      'GET /hello': {
        accepts: [
          {
            scheme: 'exact',
            price: HBAR_PRICE,
            network: 'hedera:testnet',
            payTo: RECEIVER,
          },
        ],
        description: 'Phase 0 spike — one paid hello',
        mimeType: 'application/json',
      },
    },
    resourceServer,
  ),
);

app.get('/hello', (_req, res) => {
  res.json({ hello: 'world', paid: true });
});

app.listen(PORT, () => {
  console.log(`phase0-spike listening on http://localhost:${PORT}`);
  console.log(`  GET /health  (free)`);
  console.log(`  GET /hello   (402 → 0.001 HBAR → 200, payTo ${RECEIVER})`);
  console.log(`  facilitator: ${FACILITATOR_URL}`);
});
