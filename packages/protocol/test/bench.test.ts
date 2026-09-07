import { describe, expect, it } from 'vitest';
import { BENCH_NAME, runBenchmark } from '../src/bench.js';

describe('bsp-bench: the fixed microbenchmark', () => {
  it('reports the pinned benchmark name, so two providers report the same measure', () => {
    expect(BENCH_NAME).toBe('bsp-bench-v1');
    expect(runBenchmark().name).toBe(BENCH_NAME);
  });
});

describe('bsp-bench: fixed work', () => {
  it('does byte-identical work on every run, so only machine speed varies', async () => {
    const { benchWorkload, BENCH_WORK_UNITS } = await import('../src/bench.js');
    const { BENCH_CHECKSUM } = await import('../src/bench.js');
    expect(BENCH_WORK_UNITS).toBeGreaterThan(0);
    // Pinned. If this changes, bsp-bench-v1 changed and every published score
    // stopped being comparable — bump the name, do not edit the number.
    expect(BENCH_CHECKSUM).toBe(1687408074);
    expect(benchWorkload()).toBe(BENCH_CHECKSUM);
  });
});

const fakeClock = (elapsedMs: number) => {
  let calls = 0;
  return () => (calls++ === 0 ? 1000 : 1000 + elapsedMs);
};

describe('bsp-bench: the score', () => {
  it('is work per second, so the same work in twice the time scores half', () => {
    const fast = runBenchmark({ now: fakeClock(100) });
    const slow = runBenchmark({ now: fakeClock(200) });
    expect(fast.score).toBeGreaterThan(0);
    expect(Number.isFinite(fast.score)).toBe(true);
    expect(fast.score / slow.score).toBeCloseTo(2, 3);
  });
});

describe('bsp-bench: honest labelling (SPEC §9 — attestation is out of scope)', () => {
  it('marks every result self-reported, so no listing can imply attestation', () => {
    expect(runBenchmark({ now: fakeClock(100) }).selfReported).toBe(true);
  });

  it('stamps ranAt in RFC3339 millis, so a stale score is visible as stale', () => {
    const r = runBenchmark({ now: fakeClock(100), wallClock: () => Date.parse('2026-09-07T10:00:00.500Z') });
    expect(r.ranAt).toBe('2026-09-07T10:00:00.500Z');
  });
});

describe('bsp-bench: a score it cannot stand behind', () => {
  it('refuses to report one when the clock measured no elapsed time', () => {
    expect(() => runBenchmark({ now: () => 1000 })).toThrow(/elapsed/i);
  });
});
