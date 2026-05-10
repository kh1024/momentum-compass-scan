import { getScannerSettings } from "./scannerQueue";
import { getThrottleAdjustment, type ThrottleChannel } from "./dynamicThrottle";

export class RateLimitRetryExhaustedError extends Error {
  rateLimited = true as const;
  constructor(public retryAfterMs: number, message = "Skipped due to rate limit. Try again later or reduce ticker count.") {
    super(message);
    this.name = "RateLimitRetryExhaustedError";
  }
}

export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

export async function retryWithBackoff<T>(
  task: (attempt: number) => Promise<T>,
  options: { maxRetries?: number; maxDelayMs?: number; signal?: AbortSignal; channel?: ThrottleChannel } = {},
): Promise<{ value: T; retryCount: number }> {
  const settings = getScannerSettings();
  const maxRetries = options.maxRetries ?? settings.maxRetries;
  const maxDelayMs = options.maxDelayMs ?? settings.retryBackoffMaxMs;
  const channel: ThrottleChannel = options.channel ?? "massive";
  let retryAfterMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return { value: await task(attempt), retryCount: attempt };
    } catch (error) {
      const rateLimited = Boolean(error && typeof error === "object" && (error as { rateLimited?: boolean }).rateLimited);
      if (!rateLimited || attempt >= maxRetries) {
        if (rateLimited) throw new RateLimitRetryExhaustedError(retryAfterMs || maxDelayMs);
        throw error;
      }
      retryAfterMs = Number((error as { retryAfterMs?: number }).retryAfterMs ?? 0);
      // Apply the dynamic backoff multiplier — climbs to 4× when the channel
      // is hammered with 429s and decays back to 1× when it stabilises.
      const adj = getThrottleAdjustment(channel);
      const baseRaw = retryAfterMs > 0 ? retryAfterMs : Math.min(maxDelayMs, 1000 * 2 ** attempt);
      const base = Math.min(maxDelayMs, Math.round(baseRaw * adj.backoffMult));
      await sleep(withJitter(base, maxDelayMs), options.signal);
    }
  }
  throw new RateLimitRetryExhaustedError(maxDelayMs);
}

export function withJitter(ms: number, maxDelayMs: number): number {
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.min(maxDelayMs, Math.max(250, Math.round(ms * jitter)));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}