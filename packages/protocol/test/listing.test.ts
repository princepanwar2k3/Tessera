import { describe, expect, it } from 'vitest';
import { validateListing, leadTimeFloor } from '../src/listing.js';

describe('§4.1 lead-time floor', () => {
  it('accepts the reference default 30/10', () => {
    expect(validateListing({ blockSeconds: 30, leadSeconds: 10, pricePerBlock: '1500', asset: 'HBAR' })).toEqual([]);
  });

  it('rejects lead < 4', () => {
    const issues = validateListing({ blockSeconds: 30, leadSeconds: 3, pricePerBlock: '1', asset: 'HBAR' });
    expect(issues.some((i) => i.code === 'lead_min_seconds')).toBe(true);
  });

  it('rejects lead < ceil(0.3 * block)', () => {
    // block 30 -> floor 9; lead 8 fails
    expect(leadTimeFloor(30)).toBe(9);
    const issues = validateListing({ blockSeconds: 30, leadSeconds: 8, pricePerBlock: '1', asset: 'HBAR' });
    expect(issues.some((i) => i.code === 'lead_floor')).toBe(true);
  });

  it('rejects lead >= block', () => {
    const issues = validateListing({ blockSeconds: 10, leadSeconds: 10, pricePerBlock: '1', asset: 'HBAR' });
    expect(issues.some((i) => i.code === 'lead_lt_block')).toBe(true);
  });

  it('rejects block out of 5..3600', () => {
    expect(validateListing({ blockSeconds: 4, leadSeconds: 4, pricePerBlock: '1', asset: 'HBAR' }).length).toBeGreaterThan(0);
    expect(validateListing({ blockSeconds: 3601, leadSeconds: 4, pricePerBlock: '1', asset: 'HBAR' }).length).toBeGreaterThan(0);
  });

  it('rejects non-positive price and bad asset', () => {
    expect(validateListing({ blockSeconds: 30, leadSeconds: 10, pricePerBlock: '0', asset: 'HBAR' }).some((i) => i.code === 'price_positive')).toBe(true);
    expect(validateListing({ blockSeconds: 30, leadSeconds: 10, pricePerBlock: '10', asset: 'nope' }).some((i) => i.code === 'asset_format')).toBe(true);
  });

  it('accepts the demo recording size 10/4', () => {
    expect(validateListing({ blockSeconds: 10, leadSeconds: 4, pricePerBlock: '100', asset: '0.0.12345' })).toEqual([]);
  });
});
