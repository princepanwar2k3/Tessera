import { validateBlockTiming } from "@bsp/protocol";

export type LeadTimeValidation = { ok: true } | { ok: false; reason: string };

/**
 * SPEC.md §4.1 — a registry/provider MUST reject a listing where any of:
 *   lead_seconds < 4
 *   lead_seconds < ceil(0.3 * block_seconds)
 *   lead_seconds >= block_seconds
 *
 * The rules themselves live in @bsp/protocol, which owns SPEC §4. This is a
 * shape adapter for the daemon's callers, nothing more: a second copy of the
 * arithmetic is a second thing to get wrong, and a provider whose floor
 * disagrees with the registry's is exactly the misconfiguration §4.1 exists
 * to prevent.
 */
export function validateLeadTime(blockSeconds: number, leadSeconds: number): LeadTimeValidation {
  const issues = validateBlockTiming(blockSeconds, leadSeconds);
  const first = issues[0];
  return first === undefined ? { ok: true } : { ok: false, reason: first.message };
}
