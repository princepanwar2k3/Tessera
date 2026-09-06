/**
 * Machine listing + attestation benchmark shape (Phase 1 Track B).
 * Registry-advertised; blockSeconds/leadSeconds reuse the §4.1 validator.
 */
import type { ListingParams } from './listing.js';

export interface MachineSpecs {
  cpu: string;
  memoryMB: number;
  gpu?: string;
  arch?: string;
}

export interface AttestationBenchmark {
  /** Name of the fixed microbenchmark, e.g. "bsp-bench-v1" */
  name: string;
  /** Single comparable number; higher = faster. Honestly labelled, not attested. */
  score: number;
  /** When the benchmark was run, RFC3339 millis */
  ranAt: string;
  /** Full `blockSeconds` the provider used while benchmarking (for context) */
  blockSeconds: number;
}

export interface MachineListing extends ListingParams {
  machineId: string;
  providerId: string;
  endpoint: string;
  specs: MachineSpecs;
  benchmark: AttestationBenchmark;
  live?: boolean;
  updatedAt?: string;
}

export function validateMachineListing(m: unknown): string[] {
  const issues: string[] = [];
  if (typeof m !== 'object' || m === null) return ['listing must be an object'];
  const r = m as Record<string, unknown>;
  for (const f of ['machineId', 'providerId', 'endpoint', 'specs', 'benchmark']) {
    if (r[f] === undefined) issues.push(`missing ${f}`);
  }
  const b = r['benchmark'] as Record<string, unknown> | undefined;
  if (b !== undefined) {
    if (typeof b['name'] !== 'string' || (b['name'] as string).length === 0)
      issues.push('benchmark.name required');
    if (typeof b['score'] !== 'number' || !Number.isFinite(b['score'] as number))
      issues.push('benchmark.score must be a finite number');
  }
  return issues;
}
