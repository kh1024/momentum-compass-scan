import { getScannerSettings } from "./scannerQueue";

export const MAX_CONCURRENT_REQUESTS = getScannerSettings().maxConcurrentRequests;

export class RequestLimiter {
  private active = 0;
  private queue: Array<() => void> = [];

  async run<T>(task: () => Promise<T>, maxConcurrent = getScannerSettings().maxConcurrentRequests): Promise<T> {
    await this.acquire(maxConcurrent);
    try {
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