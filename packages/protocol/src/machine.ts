/**
 * Machine listing — what a provider advertises at discovery and what the
 * console renders. SPEC §4's parameters are carried verbatim in `params`,
 * so the §4.1 floor is enforced by one validator in one place.
 */
import { validateListing, type ListingParams } from './listing.js';
import { BENCH_NAME, type BenchmarkResult } from './bench.js';

export interface MachineSpecs {
  cpuCores: number;
  memoryMB: number;
  arch: string;
  gpu?: string;
}

export interface MachineListing {
  machineId: string;
  providerId: string;
  /** Daemon base URL the renter pays and streams against. */
  endpoint: string;
  specs: MachineSpecs;
  params: ListingParams;
  benchmark: BenchmarkResult;
}

export interface MachineListingIssue {
  field: string;
  code: string;
  message: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function validateMachineListing(m: unknown): MachineListingIssue[] {
  if (!isRecord(m)) {
    return [{ field: '', code: 'not_an_object', message: 'listing must be an object' }];
  }
  const r = m as unknown as MachineListing;
  const issues: MachineListingIssue[] = [];

  for (const f of ['machineId', 'providerId', 'endpoint'] as const) {
    if (typeof r[f] !== 'string' || r[f].length === 0) {
      issues.push({ field: f, code: 'required', message: `${f} is required` });
    }
  }
  if (typeof r.endpoint === 'string' && r.endpoint.length > 0 && !isHttpUrl(r.endpoint)) {
    issues.push({
      field: 'endpoint',
      code: 'endpoint_url',
      message: 'endpoint must be an http(s) URL',
    });
  }

  if (!isRecord(r.specs)) {
    issues.push({ field: 'specs', code: 'required', message: 'specs is required' });
  } else {
    for (const f of ['cpuCores', 'memoryMB'] as const) {
      const v = r.specs[f];
      if (!Number.isInteger(v) || v <= 0) {
        issues.push({
          field: `specs.${f}`,
          code: 'positive_integer',
          message: `specs.${f} must be an integer > 0`,
        });
      }
    }
    if (typeof r.specs.arch !== 'string' || r.specs.arch.length === 0) {
      issues.push({ field: 'specs.arch', code: 'required', message: 'specs.arch is required' });
    }
  }

  if (!isRecord(r.benchmark)) {
    issues.push({ field: 'benchmark', code: 'required', message: 'benchmark is required' });
  } else {
    const b = r.benchmark as unknown as Record<string, unknown>;
    if (b['name'] !== BENCH_NAME) {
      issues.push({
        field: 'benchmark.name',
        code: 'benchmark_name',
        message: `benchmark.name must be "${BENCH_NAME}" — other benchmarks are not comparable`,
      });
    }
    if (b['selfReported'] !== true) {
      issues.push({
        field: 'benchmark.selfReported',
        code: 'not_attested',
        message: 'benchmark.selfReported must be true — BSP has no attestation (SPEC §9)',
      });
    }
    const score = b['score'];
    if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) {
      issues.push({
        field: 'benchmark.score',
        code: 'score_positive',
        message: 'benchmark.score must be a finite number > 0',
      });
    }
    if (typeof b['ranAt'] !== 'string' || Number.isNaN(Date.parse(b['ranAt']))) {
      issues.push({
        field: 'benchmark.ranAt',
        code: 'ran_at',
        message: 'benchmark.ranAt must be an RFC3339 timestamp',
      });
    }
  }

  for (const i of validateListing(r.params ?? {})) {
    issues.push({ field: `params.${i.field}`, code: i.code, message: i.message });
  }

  return issues;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Throwing form, for a provider validating its own listing at startup. */
export function assertValidMachineListing(m: unknown): asserts m is MachineListing {
  const issues = validateMachineListing(m);
  if (issues.length > 0) {
    throw new Error(`invalid machine listing: ${issues.map((i) => i.message).join('; ')}`);
  }
}
