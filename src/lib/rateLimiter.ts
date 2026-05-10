import { getScannerSettings } from "./scannerQueue";
import { getThrottleAdjustment, type ThrottleChannel } from "./dynamicThrottle";

export const MAX_CONCURRENT_REQUESTS = getScannerSettings().maxConcurrentRequests;

/**
 * Minimum spacing between successive Massive requests (ms).
 * 600ms ≈ 100 req/min — well under Massive's 5 req/s soft limit and
 * keeps us out of 429 territory on hot tickers like RIVN.
 * Override via MASSIVE_MIN_SPACING_MS.
 *
 * Dynamic throttle adds extraSpacingMs on top of this when the channel is
 * unhealthy (high latency / errors / 429s) and removes it as it recovers.
 */
const MIN_SPACING_MS = Number(process.env.MASSIVE_MIN_SPACING_MS ?? 1400);

export class RequestLimiter {
  private active = 0;
  private queue: Array<() => void> = [];
  private nextSlot = 0;

  constructor(private channel: ThrottleChannel = "massive") {}

  async run<T>(task: () => Promise<T>, maxConcurrent?: number): Promise<T> {
    const adj = getThrottleAdjustment(this.channel);
    const configured = maxConcurrent ?? getScannerSettings().maxConcurrentRequests;
    // Effective concurrency floor of 1 so we never fully stall.
    const effective = Math.max(1, Math.floor(configured * adj.concurrencyMult));
    await this.acquire(effective);
    try {
      const now = Date.now();
      const spacing = MIN_SPACING_MS + adj.extraSpacingMs;
      const wait = Math.max(0, this.nextSlot - now);
      this.nextSlot = Math.max(now, this.nextSlot) + spacing;
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

export const massiveLimiter = new RequestLimiter("massive");
