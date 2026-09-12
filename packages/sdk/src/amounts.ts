/**
 * Amounts are smallest-unit decimal strings everywhere on the wire (SPEC §4),
 * so nothing in this SDK ever puts a token amount through a float.
 */

const TINYBARS_PER_HBAR = 100_000_000n;

/** `hbar(2)` -> "200000000" tinybars. Accepts fractional HBAR. */
export function hbar(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`hbar(): expected a non-negative finite number, got ${amount}`);
  }
  // Via a fixed-point string rather than float maths: 0.1 * 1e8 is 10000000.000000002.
  const [whole = "0", frac = ""] = amount.toFixed(8).split(".");
  return (BigInt(whole) * TINYBARS_PER_HBAR + BigInt(frac.padEnd(8, "0"))).toString();
}

/** Smallest units back to a human HBAR string, for logs and the console. */
export function formatHbar(tinybars: string | bigint): string {
  const value = typeof tinybars === "bigint" ? tinybars : BigInt(tinybars);
  const whole = value / TINYBARS_PER_HBAR;
  const frac = (value % TINYBARS_PER_HBAR).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function addAmounts(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

export function multiplyAmount(amount: string, times: number): string {
  if (!Number.isInteger(times) || times < 0) {
    throw new Error(`multiplyAmount(): expected a non-negative integer, got ${times}`);
  }
  return (BigInt(amount) * BigInt(times)).toString();
}

export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
