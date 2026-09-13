/**
 * Set the renter's balance to exactly N blocks' worth, so a rehearsal ends
 * because the money ran out at a known block rather than because a counter
 * hit a limit.
 *
 *   node --env-file=.env tools/e2e/scripts/set-renter-blocks.mjs 10
 *
 * Moves the difference to or from the provider account — both are yours, and
 * the provider is where block payments accumulate anyway.
 */
import { Client, PrivateKey, AccountId, Hbar, TransferTransaction, TokenId } from '@hiero-ledger/sdk';

const BLOCKS = Number(process.argv[2] ?? 10);
const PRICE = Number(process.env.PRICE_PER_BLOCK ?? 25);
const TOKEN = TokenId.fromString(process.env.HTS_SETTLEMENT_TOKEN_ID);

const renterId = AccountId.fromString(process.env.PAYER_ID ?? process.env.HEDERA_OPERATOR_ID);
const renterKey = PrivateKey.fromStringECDSA(process.env.PAYER_KEY ?? process.env.HEDERA_OPERATOR_KEY);
const providerId = AccountId.fromString(process.env.PROVIDER_ACCOUNT_ID);
const providerKey = PrivateKey.fromStringECDSA(process.env.PROVIDER_ACCOUNT_KEY);

const target = BLOCKS * PRICE;

async function balanceOf(account) {
  const res = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/accounts/${account}/tokens?token.id=${TOKEN}`,
  );
  return (await res.json()).tokens?.[0]?.balance ?? 0;
}

const held = await balanceOf(renterId);
const delta = target - held;
console.log(`renter holds ${held}, target ${target} (${BLOCKS} blocks at ${PRICE})`);

if (delta === 0) {
  console.log('already set');
} else {
  // Whoever is losing tokens must sign, so the payer of the transaction is
  // whichever side is sending.
  const sender = delta > 0 ? providerId : renterId;
  const senderKey = delta > 0 ? providerKey : renterKey;
  const receiver = delta > 0 ? renterId : providerId;
  const amount = Math.abs(delta);

  const client = Client.forTestnet().setOperator(sender, senderKey);
  const tx = await new TransferTransaction()
    .addTokenTransfer(TOKEN, sender, -amount)
    .addTokenTransfer(TOKEN, receiver, amount)
    .setMaxTransactionFee(new Hbar(5))
    .freezeWith(client);
  await (await (await tx.sign(senderKey)).execute(client)).getReceipt(client);
  console.log(`moved ${amount} ${delta > 0 ? 'provider -> renter' : 'renter -> provider'}`);
  client.close();
}

console.log(`renter can now pay for ${BLOCKS} blocks; the job will end at block ${BLOCKS}.`);
