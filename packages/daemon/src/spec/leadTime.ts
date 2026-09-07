export type LeadTimeValidation = { ok: true } | { ok: false; reason: string };

/**
 * SPEC.md §4.1 — a registry/provider MUST reject a listing where any of:
 *   lead_seconds < 4
 *   lead_seconds < ceil(0.3 * block_seconds)
 *   lead_seconds >= block_seconds
 */
export function validateLeadTime(blockSeconds: number, leadSeconds: number): LeadTimeValidation {
  if (leadSeconds < 4) {
    return { ok: false, reason: `lead_seconds (${leadSeconds}) must be >= 4` };
  }
  const floor = Math.ceil(0.3 * blockSeconds);
  if (leadSeconds < floor) {
    return {
      ok: false,
      reason: `lead_seconds (${leadSeconds}) must be >= ceil(0.3 * block_seconds) = ${floor}`,
    };
  }
  if (leadSeconds >= blockSeconds) {
    return {
      ok: false,
      reason: `lead_seconds (${leadSeconds}) must be < block_seconds (${blockSeconds})`,
    };
  }
  return { ok: true };
}
