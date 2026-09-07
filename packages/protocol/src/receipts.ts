/**
 * Receipts — SPEC §6.2.
 * Published to the job's HCS topic on every settled block and on termination.
 */

export type ReceiptType = 'block_receipt' | 'terminated' | 'aborted';

export interface BlockReceipt {
  v: 1;
  protocol: 'bsp/0.1';
  type: 'block_receipt';
  jobId: string;
  blockIndex: number;
  providerUaid?: string;
  renterUaid?: string;
  asset: string;
  amount: string;
  /** Hedera tx id, e.g. "0.0.1234@1757844000.123456789" */
  txId: string;
  clockStartedAt: string;
  boundaryAt: string;
  providerSig?: string;
  renterSig?: string;
}

export interface TerminalReceipt {
  v: 1;
  protocol: 'bsp/0.1';
  type: 'terminated' | 'aborted';
  jobId: string;
  reason: string;
  finalBlockIndex: number;
  clockStartedAt?: string;
  providerSig?: string;
  renterSig?: string;
}

export type Receipt = BlockReceipt | TerminalReceipt;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Structural validation (no signature verification). Returns issues, empty = valid. */
export function validateReceipt(r: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(r)) return ['receipt must be an object'];
  if (r['v'] !== 1) issues.push('v must be 1');
  if (r['protocol'] !== 'bsp/0.1') issues.push('protocol must be bsp/0.1');
  const t = r['type'];
  if (t === 'block_receipt') {
    for (const f of [
      'jobId',
      'blockIndex',
      'asset',
      'amount',
      'txId',
      'clockStartedAt',
      'boundaryAt',
    ]) {
      if (r[f] === undefined) issues.push(`missing ${f}`);
    }
    if (typeof r['blockIndex'] !== 'number' || (r['blockIndex'] as number) < 1) {
      issues.push('blockIndex must be >= 1');
    }
    if (typeof r['txId'] === 'string' && !/^.+@\d+\.\d+$/.test(r['txId'] as string)) {
      issues.push('txId must look like 0.0.x@seconds.nanos');
    }
  } else if (t === 'terminated' || t === 'aborted') {
    for (const f of ['jobId', 'reason', 'finalBlockIndex']) {
      if (r[f] === undefined) issues.push(`missing ${f}`);
    }
  } else {
    issues.push('type must be block_receipt | terminated | aborted');
  }
  return issues;
}

/**
 * Canonical serialization for signing: JSON with keys sorted recursively.
 * Both parties sign these bytes.
 */
export function serializeReceiptCanonical(r: Receipt): string {
  return JSON.stringify(sortKeys(r as unknown));
}

function sortKeys(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (isRecord(x)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(x).sort()) {
      const v = x[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return x;
}

/**
 * The bytes both parties sign — the canonical form with the signature fields
 * stripped. If the signatures were covered, the renter would be signing bytes
 * that already contained the provider's signature, so the two signatures would
 * cover different messages and neither would verify against what was
 * published. Strip them and both sign the same receipt.
 */
export function receiptSigningBytes(r: Receipt): string {
  const { providerSig: _p, renterSig: _r, ...rest } = r as Receipt & Record<string, unknown>;
  return JSON.stringify(sortKeys(rest));
}
