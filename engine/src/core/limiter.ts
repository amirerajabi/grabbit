/**
 * Speed limiter: a reservation clock. Each chunk books `n / rate` seconds on the clock and waits for its slot, so
 * concurrent connections share the rate first come, first served. A short burst allowance keeps small chunks smooth.
 */
export class RateLimiter {
  private rate = 0;
  private nextFree = 0;
  private static readonly BURST_MS = 250;

  constructor(rate = 0) {
    this.setRate(rate);
  }

  /** Bytes per second; 0 = unlimited. */
  setRate(rate: number): void {
    this.rate = Math.max(0, rate);
    this.nextFree = 0;
  }

  get limited(): boolean {
    return this.rate > 0;
  }

  async take(n: number, signal?: AbortSignal): Promise<void> {
    if (this.rate <= 0 || n <= 0) return;
    const now = Date.now();
    const start = Math.max(this.nextFree, now - RateLimiter.BURST_MS);
    this.nextFree = start + (n / this.rate) * 1000;
    const wait = this.nextFree - now - RateLimiter.BURST_MS;
    if (wait > 0) await sleep(wait, signal);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Exponentially smoothed speed from byte counts sampled at a fixed interval. */
export class SpeedMeter {
  private lastBytes = 0;
  private lastAt = 0;
  private value = 0;

  reset(bytes: number): void {
    this.lastBytes = bytes;
    this.lastAt = Date.now();
    this.value = 0;
  }

  sample(bytes: number): number {
    const now = Date.now();
    const dt = (now - this.lastAt) / 1000;
    if (dt <= 0) return this.value;
    const inst = Math.max(0, bytes - this.lastBytes) / dt;
    this.value = this.value === 0 ? inst : this.value * 0.7 + inst * 0.3;
    this.lastBytes = bytes;
    this.lastAt = now;
    return this.value;
  }

  get speed(): number {
    return this.value;
  }
}
