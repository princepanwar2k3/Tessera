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

describe('fake-facilitator: slow', () => {
  it('delays settle by latencyMs, so window-expiry handling gets exercised', async () => {
    const f = new FakeFacilitator({ behaviour: 'slow', latencyMs: 60 });
    const started = Date.now();
    const r = await f.settle(KEY);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
    expect(r.latencyMs).toBe(60);
    expect(r.duplicate).toBe(false);
  });

  it('delays verify too — a slow verify still burns the renewal window', async () => {
    const f = new FakeFacilitator({ behaviour: 'slow', latencyMs: 60 });
    const started = Date.now();
    const r = await f.verify(KEY);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
    expect(r.valid).toBe(true);
  });
});

describe('fake-facilitator: over HTTP (how the daemon actually talks to it)', () => {
  it('settles once and returns the same txId on a replay', async () => {
    const f = new FakeFacilitator({ behaviour: 'success' });
    const { server, url } = await f.listen(0);
    try {
      const post = async (path: string) => {
        const res = await fetch(`${url}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(KEY),
        });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
      };
      const first = await post('/settle');
      const replay = await post('/settle');
      expect(first.status).toBe(200);
      expect(replay.body['txId']).toBe(first.body['txId']);
      expect(replay.body['duplicate']).toBe(true);
      expect(f.settledCount()).toBe(1);
    } finally {
      server.close();
    }
  });

  it('answers a rejected verify with 402, the code the daemon relays', async () => {
    const f = new FakeFacilitator({ behaviour: 'verifyReject' });
    const { server, url } = await f.listen(0);
    try {
      const res = await fetch(`${url}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(KEY),
      });
      expect(res.status).toBe(402);
      expect(((await res.json()) as Record<string, unknown>)['reason']).toBe('insufficient_funds');
    } finally {
      server.close();
    }
  });
});
