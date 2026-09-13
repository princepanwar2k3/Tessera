/**
 * Display helpers for values that come off the wire in their canonical form.
 *
 * The protocol carries an asset as `HBAR` or a token id, which is correct on
 * the wire and unreadable on a card — `25 0.0.10518829` tells a viewer
 * nothing. Where the configured settlement token is known, show its symbol;
 * otherwise shorten the id rather than inventing a name for it.
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env;

export const SETTLEMENT_TOKEN_ID: string | undefined = env?.["VITE_SETTLEMENT_TOKEN_ID"];
export const SETTLEMENT_TOKEN_SYMBOL: string = env?.["VITE_SETTLEMENT_TOKEN_SYMBOL"] ?? "TESS";

export function assetLabel(asset?: string): string {
  if (!asset) return "";
  if (asset === "HBAR") return "HBAR";
  if (SETTLEMENT_TOKEN_ID && asset === SETTLEMENT_TOKEN_ID) return SETTLEMENT_TOKEN_SYMBOL;
  // An unknown token id: keep the tail, which is what distinguishes it.
  return asset.startsWith("0.0.") ? `token ${asset.slice(4)}` : asset;
}
