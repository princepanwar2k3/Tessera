/**
 * BSP v0.1 listing parameters — SPEC §4.
 *
 * Set per listing by the provider, advertised at discovery,
 * fixed for the lifetime of a job.
 */

export interface ListingParams {
  /** 5 ≤ n ≤ 3600 */
  blockSeconds: number;
  /** Must satisfy §4.1 floor; strictly < blockSeconds */
  leadSeconds: number;
  /** Smallest-unit amount as decimal string, > 0 */
  pricePerBlock: string;
  /** Token id ("0.0.XXXXXX") or "HBAR" */
  asset: string;
}

export interface ListingValidationIssue {
  field: 'blockSeconds' | 'leadSeconds' | 'pricePerBlock' | 'asset';
  code: string;
  message: string;
}

export function leadTimeFloor(blockSeconds: number): number {
  return Math.max(4, Math.ceil(0.3 * blockSeconds));
}

/**
 * Validate a listing per SPEC §4.1.
 * Returns a list of issues (empty = valid). Never throws on bad input.
 */
/**
 * The §4.1 timing rules on their own, for callers that have block and lead
 * seconds but no price or asset yet — a provider validating its own
 * configuration, for instance. `validateListing` delegates here so the rules
 * live in exactly one place.
 */
export function validateBlockTiming(
  blockSeconds: unknown,
  leadSeconds: unknown,
): ListingValidationIssue[] {
  const issues: ListingValidationIssue[] = [];
  const bs = blockSeconds;
  const ls = leadSeconds;

  if (!Number.isInteger(bs) || (bs as number) < 5 || (bs as number) > 3600) {
    issues.push({
      field: 'blockSeconds',
      code: 'block_range',
      message: 'blockSeconds must be an integer with 5 <= n <= 3600',
    });
  }

  if (!Number.isInteger(ls)) {
    issues.push({
      field: 'leadSeconds',
      code: 'lead_integer',
      message: 'leadSeconds must be an integer',
    });
    return issues;
  }

  if ((ls as number) < 4) {
    issues.push({
      field: 'leadSeconds',
      code: 'lead_min_seconds',
      message: 'leadSeconds must be >= 4',
    });
  }

  if (!Number.isInteger(bs)) return issues;

  const floor = leadTimeFloor(bs as number);
  if ((ls as number) < floor) {
    issues.push({
      field: 'leadSeconds',
      code: 'lead_floor',
      message: `leadSeconds must be >= ceil(0.3 * blockSeconds) = ${floor}`,
    });
  }
  if ((ls as number) >= (bs as number)) {
    issues.push({
      field: 'leadSeconds',
      code: 'lead_lt_block',
      message: 'leadSeconds must be < blockSeconds',
    });
  }

  return issues;
}

/**
 * Validate a listing per SPEC §4.1.
 * Returns a list of issues (empty = valid). Never throws on bad input.
 */
export function validateListing(p: Partial<ListingParams>): ListingValidationIssue[] {
  const issues: ListingValidationIssue[] = validateBlockTiming(p.blockSeconds, p.leadSeconds);

  const price = p.pricePerBlock;
  if (typeof price !== 'string' || !/^[0-9]+$/.test(price)) {
    issues.push({
      field: 'pricePerBlock',
      code: 'price_format',
      message: 'pricePerBlock must be a decimal integer string in smallest units',
    });
  } else if (BigInt(price) <= 0n) {
    issues.push({
      field: 'pricePerBlock',
      code: 'price_positive',
      message: 'pricePerBlock must be > 0',
    });
  }

  const asset = p.asset;
  if (typeof asset !== 'string' || asset.length === 0) {
    issues.push({
      field: 'asset',
      code: 'asset_required',
      message: 'asset must be a token id or HBAR',
    });
  } else if (asset !== 'HBAR' && !/^\d+\.\d+\.\d+$/.test(asset)) {
    issues.push({
      field: 'asset',
      code: 'asset_format',
      message: 'asset must be "HBAR" or a token id like "0.0.XXXXXX"',
    });
  }

  return issues;
}

export function assertValidListing(p: ListingParams): void {
  const issues = validateListing(p);
  if (issues.length > 0) {
    throw new Error(`invalid listing: ${issues.map((i) => i.message).join('; ')}`);
  }
}

/** Reference default from SPEC §4.2. */
export const REFERENCE_DEFAULT = { blockSeconds: 30, leadSeconds: 10 } as const;
