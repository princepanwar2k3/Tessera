import type { Clock } from "./clock.js";

/**
 * Deterministic test clock. `tick(ms)` advances virtual time in 1ms steps
 * (or in `stepMs` increments — see below) and invokes any due callbacks
 * synchronously, so watchdog tests never depend on real wall-clock waiting.
 */
export class FakeClock implements Clock {
  private currentTime: number;
  private nextHandle = 1;
  private readonly intervals = new Map<number, { fn: () => void; ms: number; next: number }>();

  constructor(startTime = 0) {
    this.currentTime = startTime;
  }

  now(): number {
    return this.currentTime;
  }

  setInterval(fn: () => void, ms: number): unknown {
    const handle = this.nextHandle++;
    this.intervals.set(handle, { fn, ms, next: this.currentTime + ms });
    return handle;
  }

  clearInterval(handle: unknown): void {
    this.intervals.delete(handle as number);
  }

  /** Advance virtual time by `ms`, firing any interval callbacks whose turn has come. */
  tick(ms: number): void {
    const target = this.currentTime + ms;
    // Fire due callbacks in time order, one at a time, so multiple firings
    // within one tick() call are each visible at their correct timestamp.
    while (true) {
      let due: { handle: number; entry: { fn: () => void; ms: number; next: number } } | undefined;
      for (const [handle, entry] of this.intervals) {
        if (entry.next <= target && (!due || entry.next < due.entry.next)) {
          due = { handle, entry };
        }
      }
      if (!due) break;
      this.currentTime = due.entry.next;
      due.entry.next += due.entry.ms;
      due.entry.fn();
    }
    this.currentTime = target;
  }
}
