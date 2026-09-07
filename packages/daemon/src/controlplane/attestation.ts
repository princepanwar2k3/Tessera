/**
 * The provider's self-reported benchmark.
 *
 * NOT hardware attestation — SPEC §9 puts that out of scope. It raises the
 * cost of lying about hardware; it does not make lying impossible. The
 * `selfReported` flag on the result says so structurally, so no listing can
 * present the number as verified.
 *
 * The benchmark itself is `bsp-bench-v1` from @bsp/protocol, deliberately not
 * a daemon-local one. A score is only worth publishing if another provider's
 * score means the same thing, and that requires every provider to run
 * byte-identical work — which is why the protocol pins the workload by
 * checksum rather than just naming it.
 */
export {
  runBenchmark,
  BENCH_NAME,
  BENCH_WORK_UNITS,
  type BenchmarkResult,
  type BenchmarkResult as AttestationResult,
} from "@bsp/protocol";
