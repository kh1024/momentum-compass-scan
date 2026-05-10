import { getScannerSettings } from "./scannerQueue";

export const MAX_CONCURRENT_REQUESTS = getScannerSettings().maxConcurrentRequests;

/**
 * Minimum spacing between successive Massive requests (ms).
 * 600ms ≈ 100 req/min — well under Massive's 5 req/s soft limit and
 * keeps us out of 429 territory on hot tickers like RIVN.
 * Override via MASSIVE_MIN_SPACING_MS.
 */
const MIN_SPACING_MS = Number(process.env.MASSIVE_MIN_SPACING_MS ?? 600);

export class RequestLimiter {
  private active = 0;
  private queue: Array<() => void> = [];
  private nextSlot = 0;

  async run<T>(task: () => Promise<T>, maxConcurrent = getScannerSettings().maxConcurrentRequests): Promise<T> {
    await this.acquire(maxConcurrent);
    try {
      // Pace requests: never start a new one within MIN_SPACING_MS of the previous.
      const now = Date.now();
      const wait = Math.max(0, this.nextSlot - now);
      this.nextSlot = Math.max(now, this.nextSlot) + MIN_SPACING_MS;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(maxConcurrent: number): Promise<void> {
    if (this.active < maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

export const massiveLimiter = new RequestLimiter();
