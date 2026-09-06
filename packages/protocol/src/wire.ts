/**
 * Wire format — SPEC §6.1 (payment requirement) and §6.3 (errors).
 * Stock x402 with a namespaced `blockMeta` extension.
 *
 * NOTE (observed Phase 0, docs/facilitator-contract.md §2): this transcribes
 * SPEC §6.1 as written (x402Version 1, `maxAmountRequired`). The live
 * Blocky402 testnet facilitator speaks x402 **v2** (`amount`,
 * `extra.feePayer`, `maxTimeoutSeconds`). The `blockMeta` extension envelope
 * is unaffected, but the x402 half of §6.1 must be reconciled with the v2
 * wire before Phase 3. Do not treat these types as the live format.
 */

export interface X402Accept {
  scheme: 'exact';
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  facilitator?: string;
  [k: string]: unknown;
}

export interface BlockMeta {
  protocol: 'bsp/0.1';
  jobId: string;
  blockIndex: number;
  blockSeconds: number;
  leadSeconds: number;
  /** RFC 3339 UTC millis */
  clockStartedAt?: string;
  windowOpensAt: string;
  boundaryAt: string;
}

export interface PaymentRequirement {
  x402Version: 1;
  accepts: X402Accept[];
  blockMeta: BlockMeta;
}

export function toRfc3339Millis(ms: number): string {
  return new Date(ms).toISOString();
}

export function parseRfc3339Millis(s: string): number {
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`invalid RFC3339 timestamp: ${s}`);
  return t;
}

export interface BuildPaymentRequirementArgs {
  network: string;
  asset: string;
  payTo: string;
  amount: string;
  resource: string;
  description: string;
  facilitator?: string;
  jobId: string;
  blockIndex: number;
  blockSeconds: number;
  leadSeconds: number;
  clockStartedAt?: number;
  windowOpensAt: number;
  boundaryAt: number;
}

export function buildPaymentRequirement(a: BuildPaymentRequirementArgs): PaymentRequirement {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: a.network,
        asset: a.asset,
        payTo: a.payTo,
        maxAmountRequired: a.amount,
        resource: a.resource,
        description: a.description,
        ...(a.facilitator ? { facilitator: a.facilitator } : {}),
      },
    ],
    blockMeta: {
      protocol: 'bsp/0.1',
      jobId: a.jobId,
      blockIndex: a.blockIndex,
      blockSeconds: a.blockSeconds,
      leadSeconds: a.leadSeconds,
      ...(a.clockStartedAt !== undefined
        ? { clockStartedAt: toRfc3339Millis(a.clockStartedAt) }
        : {}),
      windowOpensAt: toRfc3339Millis(a.windowOpensAt),
      boundaryAt: toRfc3339Millis(a.boundaryAt),
    },
  };
}

// --- §6.3 error bodies ---

export type ErrorCode = 'out_of_order' | 'job_closed' | 'window_closed';

export interface OutOfOrderBody {
  error: 'out_of_order';
  expectedBlockIndex: number;
}
export interface JobClosedBody {
  error: 'job_closed';
  finalBlockIndex: number;
  reason: string;
}
export interface WindowClosedBody {
  error: 'window_closed';
  windowOpensAt: string;
}

export function outOfOrder(expectedBlockIndex: number): OutOfOrderBody {
  return { error: 'out_of_order', expectedBlockIndex };
}
export function jobClosed(finalBlockIndex: number, reason: string): JobClosedBody {
  return { error: 'job_closed', finalBlockIndex, reason };
}
export function windowClosed(windowOpensAtMs: number): WindowClosedBody {
  return { error: 'window_closed', windowOpensAt: toRfc3339Millis(windowOpensAtMs) };
}
