/**
 * Links out to the public record.
 *
 * Every transaction id and topic id the console shows is real and checkable,
 * and a settlement claim nobody can verify is just a number on a page — so
 * anything machine-produced that has a public counterpart is a link to it.
 */
const NETWORK: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.["VITE_HEDERA_NETWORK"] ??
  "testnet";

export const HCS_TOPIC_ID: string | undefined = (
  import.meta as { env?: Record<string, string | undefined> }
).env?.["VITE_HCS_TOPIC_ID"];

export function transactionUrl(txId: string): string {
  return `https://hashscan.io/${NETWORK}/transaction/${encodeURIComponent(txId)}`;
}

export function topicUrl(topicId: string): string {
  return `https://hashscan.io/${NETWORK}/topic/${encodeURIComponent(topicId)}`;
}

export function accountUrl(accountId: string): string {
  return `https://hashscan.io/${NETWORK}/account/${encodeURIComponent(accountId)}`;
}

/**
 * A mock settlement mints an id under a placeholder payer. Real testnet ids
 * come from the facilitator's account. Showing a dead HashScan link for a
 * mock run would be worse than showing none.
 */
export function isRealTransaction(txId: string): boolean {
  return /^0\.0\.\d+@\d+\.\d+$/.test(txId) && !txId.startsWith("0.0.999999@");
}
