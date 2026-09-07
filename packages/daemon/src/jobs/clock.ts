export interface Clock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  setInterval(fn: () => void, ms: number): unknown {
    const handle = setInterval(fn, ms);
    // Don't keep the process alive solely because the watchdog is ticking.
    if (typeof handle === "object" && handle !== null && "unref" in handle) {
      (handle as { unref(): void }).unref();
    }
    return handle;
  }
  clearInterval(handle: unknown): void {
    clearInterval(handle as NodeJS.Timeout);
  }
}
