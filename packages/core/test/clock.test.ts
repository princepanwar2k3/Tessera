import { describe, expect, it } from 'vitest';
import { createJob, reduce, getPaymentDecision, type JobState } from '../src/clock.js';

const CFG = { blockSeconds: 30, leadSeconds: 10 };
const T0 = 1_786_000_000_000; // fixed fake clock base

/** Drive a job to running(block 1) with clock started at T0. */
function startRunning(): JobState {
  let s = createJob(CFG);
  [s] = reduce(s, { t: 'payment_settled', blockIndex: 1 }, T0 - 5000);
  [s] = reduce(s, { t: 'service_ready' }, T0);
  expect(s.status).toBe('running');
  expect(s.boundaryAt).toBe(T0 + 30_000);
  return s;
}

describe('SPEC §7 required behaviours (fake clock)', () => {
  it('payment inside window, 500ms before boundary → accepted, job advances', () => {
    let s = startRunning();
    const boundary = s.boundaryAt!;
    const openAt = boundary - 10_000;
    // Before window: decision is 425.
    expect(getPaymentDecision(s, 2, openAt - 1).ok).toBe(false);
    // Settle block 2 half a second before the boundary.
    const payAt = boundary - 500;
    const d = getPaymentDecision(s, 2, payAt);
    expect(d).toEqual({ ok: true, duplicate: false });
    [s] = reduce(s, { t: 'payment_settled', blockIndex: 2 }, payAt);
    expect(s.paidThrough).toBe(2);
    // Cross the boundary: advances to block 2, does not terminate.
    let effects;
    [s, effects] = reduce(s, { t: 'tick' }, boundary);
    expect(s.status).toBe('running');
    expect(s.blockIndex).toBe(2);
    expect(effects.some((e) => e.t === 'advance')).toBe(true);
    expect(effects.some((e) => e.t === 'terminate')).toBe(false);
  });

  it('payment after boundary → 410, terminated, payment not captured', () => {
    let s = startRunning();
    const boundary = s.boundaryAt!;
    let effects;
    [s, effects] = reduce(s, { t: 'tick' }, boundary + 1);
    expect(s.status).toBe('expired');
    expect(effects.some((e) => e.t === 'terminate')).toBe(true);
    const d = getPaymentDecision(s, 2, boundary + 2000);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.http).toBe(410);
    // Even if the settle event arrived, a terminal job absorbs it.
    const before = s.paidThrough;
    [s] = reduce(s, { t: 'payment_settled', blockIndex: 2 }, boundary + 2000);
    expect(s.paidThrough).toBe(before);
    expect(s.status).toBe('expired');
  });

  it('payment for n+2 while n+1 unpaid → 409 with expectedBlockIndex', () => {
    let s = startRunning();
    const boundary = s.boundaryAt!;
    const openAt = boundary - 10_000;
    const d = getPaymentDecision(s, 3, openAt + 1000);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.http).toBe(409);
      expect(d.code).toBe('out_of_order');
      expect(d.expectedBlockIndex).toBe(2);
    }
    // Reducer holds the line even if the gate is bypassed.
    const before = s;
    let next;
    [next] = reduce(s, { t: 'payment_settled', blockIndex: 3 }, openAt + 1000);
    expect(next.paidThrough).toBe(before.paidThrough);
    expect(next.blockIndex).toBe(before.blockIndex);
  });

  it('duplicate payment for a settled block → idempotent 200, no double charge', () => {
    let s = startRunning();
    const d = getPaymentDecision(s, 1, T0 + 1000);
    expect(d).toEqual({ ok: true, duplicate: true });
    let effects;
    [s, effects] = reduce(s, { t: 'payment_settled', blockIndex: 1 }, T0 + 1000);
    expect(s.paidThrough).toBe(1);
    expect(s.blockIndex).toBe(1);
    expect(effects).toEqual([{ t: 'emit_receipt', blockIndex: 1 }]);
  });

  it('payment before window opens → 425 with windowOpensAt', () => {
    let s = startRunning();
    const boundary = s.boundaryAt!;
    const openAt = boundary - 10_000;
    const d = getPaymentDecision(s, 2, openAt - 1000);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.http).toBe(425);
      expect(d.code).toBe('window_closed');
      expect(d.windowOpensAt).toBe(openAt);
    }
  });

  it('provisioning exceeding one block → clock still starts at service_ready with a full block 1', () => {
    let s = createJob(CFG);
    const paidAt = T0;
    [s] = reduce(s, { t: 'payment_settled', blockIndex: 1 }, paidAt);
    // Provisioning takes 5 minutes (10x blockSeconds): provider-borne.
    const readyAt = paidAt + 300_000;
    [s] = reduce(s, { t: 'service_ready' }, readyAt);
    expect(s.status).toBe('running');
    expect(s.clockStartedAt).toBe(readyAt);
    expect(s.boundaryAt).toBe(readyAt + 30_000);
  });

  it('service exits mid-block → completed, remainder forfeited', () => {
    let s = startRunning();
    let effects;
    [s, effects] = reduce(s, { t: 'service_exited' }, T0 + 5000);
    expect(s.status).toBe('completed');
    expect(effects.some((e) => e.t === 'terminate')).toBe(true);
    // Closed: further payment is 410.
    expect(getPaymentDecision(s, 2, T0 + 6000).ok).toBe(false);
  });

  it('provider fails mid-block → aborted; renter loses at most that block', () => {
    let s = startRunning();
    let effects;
    [s, effects] = reduce(s, { t: 'provider_failed', reason: 'oom' }, T0 + 7000);
    expect(s.status).toBe('aborted');
    if (s.status === 'aborted') expect(s.finalBlockIndex).toBe(1);
    expect(effects.some((e) => e.t === 'terminate')).toBe(true);
  });

  it('renter disappears → job terminates at the next boundary, no handshake', () => {
    let s = startRunning();
    const boundary = s.boundaryAt!;
    // Alive 1s before the boundary…
    let s2;
    [s2] = reduce(s, { t: 'tick' }, boundary - 1000);
    expect(s2.status).toBe('running');
    // …dead just after it.
    let s3;
    [s3] = reduce(s, { t: 'tick' }, boundary + 10);
    expect(s3.status).toBe('expired');
  });

  it('I1: no sequence reaches running with paidThrough < blockIndex', () => {
    // service_ready without payment must not start the clock.
    let s = createJob(CFG);
    [s] = reduce(s, { t: 'service_ready' }, T0);
    expect(s.status).not.toBe('running');
    // Normal path: paidThrough(1) >= blockIndex(1).
    s = startRunning();
    expect(s.paidThrough).toBeGreaterThanOrEqual(s.blockIndex);
    // Advance keeps the invariant: paid(2) > block(1) before stepping.
    const boundary = s.boundaryAt!;
    [s] = reduce(s, { t: 'payment_settled', blockIndex: 2 }, boundary - 500);
    let effects;
    [s, effects] = reduce(s, { t: 'tick' }, boundary);
    expect(s.status).toBe('running');
    expect(s.paidThrough).toBeGreaterThanOrEqual(s.blockIndex);
    void effects;
  });

  it('I3: terminate is never emitted while now < boundaryAt', () => {
    let s = startRunning();
    const boundary = s.boundaryAt!;
    // Probe every second of the unpaid block: never terminates early.
    for (let t = T0; t < boundary; t += 1000) {
      const [ns, effects] = reduce(s, { t: 'tick' }, t);
      expect(effects.some((e) => e.t === 'terminate')).toBe(false);
      expect(ns.status).toBe('running');
      s = ns;
    }
    // Window must have been announced exactly once.
    const announced = s.windowAnnouncedFor;
    expect(announced).toBe(2);
    const [, fx] = reduce(s, { t: 'tick' }, boundary - 1);
    expect(fx.filter((e) => e.t === 'open_window').length).toBe(0);
  });

  it('open_window fires once at window open, not on every tick', () => {
    let s = startRunning();
    const boundary = s.boundaryAt!;
    const openAt = boundary - 10_000;
    let s2, fx;
    [s2, fx] = reduce(s, { t: 'tick' }, openAt);
    expect(fx).toEqual([{ t: 'open_window', blockIndex: 2 }]);
    [s2, fx] = reduce(s2, { t: 'tick' }, openAt + 1000);
    expect(fx).toEqual([]);
    void s;
  });

  it('property: random event sequences never break I1/I3', () => {
    // Deterministic PRNG (mulberry32) so the test is reproducible.
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
    for (let trial = 0; trial < 200; trial++) {
      let s = createJob({ blockSeconds: 10, leadSeconds: 4 });
      let now = T0 + trial * 1000;
      for (let step = 0; step < 30; step++) {
        now += Math.floor(rnd() * 4000);
        const r = rnd();
        const ev =
          r < 0.4
            ? ({ t: 'tick' } as const)
            : r < 0.6
              ? ({ t: 'payment_settled', blockIndex: Math.max(1, s.paidThrough + (rnd() < 0.8 ? 1 : 2)) } as const)
              : r < 0.75
                ? ({ t: 'service_ready' } as const)
                : r < 0.85
                  ? ({ t: 'service_exited' } as const)
                  : ({ t: 'provider_failed' } as const);
        const [ns, effects] = reduce(s, ev, now);
        // I1
        if (ns.status === 'running' || ns.status === 'closing') {
          expect(ns.paidThrough).toBeGreaterThanOrEqual(ns.blockIndex);
        }
        // I3: terminate only at/after the serving boundary, or from
        // service exit / provider failure (which carry their own reasons).
        for (const e of effects) {
          if (e.t === 'terminate' && e.reason === 'unpaid_boundary') {
            expect(ns.status).toBe('expired');
          }
        }
        s = ns;
        if (s.status === 'expired' || s.status === 'completed' || s.status === 'aborted') break;
      }
    }
  });
});
