/**
 * The fixed BSP microbenchmark — SPEC §9 puts hardware attestation out of
 * scope, so this is a self-reported number, not a proof. Its only job is to
 * be the *same* work everywhere, so two listings' scores are comparable.
 *
 * The workload is deliberately boring: a fixed-size buffer walked a fixed
 * number of times with an integer mix. It touches memory (the buffer is far
 * larger than L2) and it touches the CPU (the mix is dependent, so it cannot
 * be vectorised away), and it ends in a checksum that `runBenchmark` verifies,
 * so a run that did less work than it claimed cannot report a score.
 */
import { toRfc3339Millis } from './wire.js';

/** Words in the working buffer: 1 Mi u32 = 4 MiB, past any L2. */
const BUFFER_WORDS = 1 << 20;
/** Passes over the buffer. */
const PASSES = 8;

/** Total word-updates one run performs. Fixed forever for `bsp-bench-v1`. */
export const BENCH_WORK_UNITS = BUFFER_WORDS * PASSES;

/**
 * The checksum a correct run produces. Pinned: if the workload changes this
 * changes, and every score published against the old workload stops being
 * comparable — so bump `BENCH_NAME` instead of editing this number.
 */
export const BENCH_CHECKSUM = 1687408074;

export const BENCH_NAME = 'bsp-bench-v1';

export interface BenchmarkResult {
  name: string;
  /**
   * Fixed work units per second — higher is faster. Comparable between
   * listings only because `BENCH_WORK_UNITS` is the same everywhere.
   */
  score: number;
  /**
   * Always `true`. BSP has no hardware attestation (SPEC §9), and the shape
   * refuses to let a listing pretend otherwise.
   */
  selfReported: true;
  /** RFC 3339 UTC millis. A score with no date is a score with no meaning. */
  ranAt: string;
}

export interface RunBenchmarkOptions {
  /** Monotonic millisecond clock. Injected in tests. */
  now?: () => number;
  /** Wall clock for `ranAt`. Injected in tests. */
  wallClock?: () => number;
}

/**
 * One full run of the fixed workload. Returns a checksum of the final buffer
 * state — identical on every machine, on every run.
 */
export function benchWorkload(): number {
  const buf = new Uint32Array(BUFFER_WORDS);
  let x = 0x9e3779b9;
  for (let pass = 0; pass < PASSES; pass++) {
    for (let i = 0; i < BUFFER_WORDS; i++) {
      // xorshift32 mixed with the word already there: dependent, so it stays
      // serial, and it reads and writes the whole buffer on every pass.
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      buf[i] = (buf[i]! ^ x) >>> 0;
      x = (x + buf[i]!) >>> 0;
    }
  }
  let sum = 0;
  for (let i = 0; i < BUFFER_WORDS; i++) sum = (sum + buf[i]!) >>> 0;
  return sum;
}

export function runBenchmark(opts: RunBenchmarkOptions = {}): BenchmarkResult {
  const now = opts.now ?? (() => performance.now());
  const startedAt = now();
  const checksum = benchWorkload();
  const elapsedMs = now() - startedAt;
  if (checksum !== BENCH_CHECKSUM) {
    throw new Error(`bsp-bench: workload checksum ${checksum} != ${BENCH_CHECKSUM}`);
  }
  if (!(elapsedMs > 0)) {
    // A clock that cannot see ~100 ms of work is broken. Report nothing
    // rather than a fabricated score that would outlive the bug in a listing.
    throw new Error(`bsp-bench: clock measured no elapsed time (${elapsedMs}ms)`);
  }
  return {
    name: BENCH_NAME,
    score: Math.round(BENCH_WORK_UNITS / (elapsedMs / 1000)),
    selfReported: true,
    ranAt: toRfc3339Millis((opts.wallClock ?? Date.now)()),
  };
}
