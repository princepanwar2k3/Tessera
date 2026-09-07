import { describe, expect, it } from 'vitest';
import { validateMachineListing, type MachineListing } from '../src/machine.js';

const listing = (over: Record<string, unknown> = {}): MachineListing =>
  ({
    machineId: 'node-a',
    providerId: '0.0.4242',
    endpoint: 'https://node-a.tessera.example',
    specs: { cpuCores: 8, memoryMB: 16384, arch: 'x86_64' },
    params: { blockSeconds: 30, leadSeconds: 10, pricePerBlock: '1500', asset: 'HBAR' },
    benchmark: {
      name: 'bsp-bench-v1',
      score: 83_886_080,
      selfReported: true,
      ranAt: '2026-09-07T10:00:00.000Z',
    },
    ...over,
  }) as MachineListing;

describe('machine listing schema', () => {
  it('accepts a complete, well-formed listing', () => {
    expect(validateMachineListing(listing())).toEqual([]);
  });
});

describe('machine listing: §4.1 is enforced at the listing, not only at the params', () => {
  it('rejects a lead time under the floor, naming the nested field', () => {
    const issues = validateMachineListing(
      listing({ params: { blockSeconds: 30, leadSeconds: 8, pricePerBlock: '1500', asset: 'HBAR' } }),
    );
    expect(issues.map((i) => i.code)).toContain('lead_floor');
    expect(issues.every((i) => i.field.startsWith('params.'))).toBe(true);
  });
});

describe('machine listing: hostile input', () => {
  it('reports an issue instead of throwing on a non-object', () => {
    for (const bad of [null, undefined, 'listing', 42, []]) {
      const issues = validateMachineListing(bad);
      expect(issues.length).toBeGreaterThan(0);
    }
  });
});

describe('machine listing: identity', () => {
  it('requires machineId, providerId and endpoint, one issue each', () => {
    const bare = listing();
    delete (bare as Partial<MachineListing>).machineId;
    delete (bare as Partial<MachineListing>).providerId;
    delete (bare as Partial<MachineListing>).endpoint;
    const issues = validateMachineListing(bare);
    expect(issues.map((i) => i.field).sort()).toEqual(['endpoint', 'machineId', 'providerId']);
    expect(issues.every((i) => i.code === 'required')).toBe(true);
  });

  it('rejects an endpoint that is not an http(s) URL', () => {
    const issues = validateMachineListing(listing({ endpoint: 'node-a.example' }));
    expect(issues).toEqual([
      { field: 'endpoint', code: 'endpoint_url', message: 'endpoint must be an http(s) URL' },
    ]);
  });
});

describe('machine listing: specs', () => {
  it('requires positive integer cpuCores and memoryMB and an arch', () => {
    const issues = validateMachineListing(
      listing({ specs: { cpuCores: 0, memoryMB: 1024.5, arch: '' } }),
    );
    expect(issues.map((i) => i.field).sort()).toEqual([
      'specs.arch',
      'specs.cpuCores',
      'specs.memoryMB',
    ]);
  });

  it('requires the specs block at all', () => {
    const bare = listing();
    delete (bare as Partial<MachineListing>).specs;
    expect(validateMachineListing(bare)).toEqual([
      { field: 'specs', code: 'required', message: 'specs is required' },
    ]);
  });
});

describe('machine listing: benchmark', () => {
  const bench = (over: Record<string, unknown>) =>
    validateMachineListing(
      listing({
        benchmark: {
          name: 'bsp-bench-v1',
          score: 1,
          selfReported: true,
          ranAt: '2026-09-07T10:00:00.000Z',
          ...over,
        },
      }),
    );

  it('rejects a score from some other benchmark, which would not be comparable', () => {
    expect(bench({ name: 'geekbench' }).map((i) => i.code)).toEqual(['benchmark_name']);
  });

  it('rejects a listing that drops the self-reported label', () => {
    expect(bench({ selfReported: false }).map((i) => i.code)).toEqual(['not_attested']);
  });

  it('rejects a non-positive or non-finite score', () => {
    expect(bench({ score: 0 }).map((i) => i.code)).toEqual(['score_positive']);
    expect(bench({ score: Infinity }).map((i) => i.code)).toEqual(['score_positive']);
  });

  it('rejects an unparseable ranAt', () => {
    expect(bench({ ranAt: 'last tuesday' }).map((i) => i.code)).toEqual(['ran_at']);
  });

  it('requires the benchmark block at all', () => {
    const bare = listing();
    delete (bare as Partial<MachineListing>).benchmark;
    expect(validateMachineListing(bare)).toEqual([
      { field: 'benchmark', code: 'required', message: 'benchmark is required' },
    ]);
  });
});

describe('machine listing: round trip with the real benchmark', () => {
  it('accepts a listing carrying an actual runBenchmark() result', async () => {
    const { runBenchmark } = await import('../src/bench.js');
    expect(validateMachineListing(listing({ benchmark: runBenchmark() }))).toEqual([]);
  });

  it('assertValidMachineListing throws on a listing the registry would reject', async () => {
    const { assertValidMachineListing } = await import('../src/machine.js');
    expect(() => assertValidMachineListing(listing({ endpoint: 'nope' }))).toThrow(/endpoint/);
    expect(() => assertValidMachineListing(listing())).not.toThrow();
  });
});
