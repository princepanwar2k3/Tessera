import { createHash } from "node:crypto";

export interface AttestationResult {
  score: number;
  unit: "hashes_per_sec";
  ranAt: string;
  note: string;
}

/**
 * Placeholder benchmark, NOT real hardware attestation. Raises the cost of
 * lying about hardware; does not make lying impossible. A production
 * version would need real remote attestation. Documented as a boundary,
 * not hidden as a limitation (see PLAN.md §7 "Status" guidance).
 */
export function runBenchmark(iterations = 200_000): AttestationResult {
  const start = performance.now();
  let buffer = Buffer.from("tessera-attestation-seed");
  for (let i = 0; i < iterations; i++) {
    buffer = createHash("sha256").update(buffer).digest();
  }
  const elapsedSeconds = (performance.now() - start) / 1000;
  const score = Math.round(iterations / elapsedSeconds);
  return {
    score,
    unit: "hashes_per_sec",
    ranAt: new Date().toISOString(),
    note: "CPU timing benchmark only; not a cryptographic hardware attestation.",
  };
}
