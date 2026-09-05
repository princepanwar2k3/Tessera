import { describe, expect, it } from 'vitest';
import { FakeFacilitator } from '../src/index.js';

const KEY = { jobId: 'j_1', blockIndex: 1, amount: '1500', asset: 'HBAR' };

describe('fake-facilitator', () => {
  it('success settles immediately', async () => {
    const f = new FakeFacilitator({ behaviour: 'success' });
    const r = await f.settle(KEY);
    expect(r.duplicate).toBe(false);
    expect(r.txId).toMatch(/@/);
  });

  it('duplicate settle returns the original txId (no double charge)', async () => {
    const f = new FakeFacilitator({ behaviour: 'success' });
    const a = await f.settle(KEY);
    const b = await f.settle(KEY);
    expect(b.duplicate).toBe(true);
    expect(b.txId).toBe(a.txId);
    expect(f.settledCount()).toBe(1);
  });

  it("'duplicate' behaviour is idempotent by construction", async () => {
    const f = new FakeFacilitator({ behaviour: 'duplicate' });
    const a = await f.settle(KEY);
    const b = await f.settle({ ...KEY, blockIndex: 1 });
    expect(b).toEqual({ ...a, duplicate: true });
  });

  it('timeout rejects so the SDK can retry inside the window', async () => {
    const f = new FakeFacilitator({ behaviour: 'timeout', timeoutMs: 20 });
    await expect(f.settle(KEY)).rejects.toThrow(/timeout/);
  });

  it('verifyReject marks payment invalid', async () => {
    const f = new FakeFacilitator({ behaviour: 'verifyReject' });
    const r = await f.verify(KEY);
    expect(r.valid).toBe(false);
  });
});
