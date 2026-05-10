/**
 * Bounded retry with exponential backoff + jitter for transient errors.
 *
 * Retries on:
 *   - Network errors (fetch threw — DNS, TCP reset, abort)
 *   - HTTP 5xx (server hiccup)
 *   - HTTP 408 / 425 (timeout-class)
 *
 * Never retries on:
 *   - HTTP 429 (rate limit — would create a storm; caller handles cooldown)
 *   - HTTP 4xx other than 408/425 (client errors are not transient)
 *
 * Defaults: 3 attempts total, 250ms base, 2× factor, ±30% jitter, 4s cap.
 * Honors `Retry-After` (seconds or HTTP-date) when present on 5xx responses.
 */

export interface RetryOptions {
  attempts?: number;        // total tries including first (default 3)
  baseDelayMs?: number;     // initial backoff (default 250)
  maxDelayMs?: number;      // per-attempt cap (default 4000)
  factor?: number;          // multiplier (default 2)
  jitter?: number;          // 0..1 fraction (default 0.3)
  signal?: AbortSignal;
}

const DEFAULTS: Required<Omit<RetryOptions, "signal">> = {
  attempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  factor: 2,
  jitter: 0.3,
};

function isTransientStatus(status: number): boolean {
  if (status >= 500 && status <= 599) return true;
  if (status === 408 || status === 425) return true;
  return false;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 30_000);
  const when = Date.parse(header);
  if (isFinite(when)) return Math.max(0, Math.min(when - Date.now(), 30_000));
  return null;
}

function backoff(attempt: number, opts: Required<Omit<RetryOptions, "signal">>): number {
  const raw = Math.min(opts.maxDelayMs, opts.baseDelayMs * Math.pow(opts.factor, attempt));
  const j = 1 + (Math.random() * 2 - 1) * opts.jitter;
  return Math.max(0, Math.round(raw * j));
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => { clearTimeout(t); reject(new Error("aborted")); };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });

/**
 * Fetch with bounded retry for transient failures.
 * Returns the final Response (which may still be non-OK on the last attempt).
 * Callers handle 4xx/429 themselves — this helper only retries 5xx + network.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const opts = { ...DEFAULTS, ...options };
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    try {
      const res = await fetch(input, { ...init, signal: options.signal ?? init.signal });
      // Success or non-transient failure — return immediately.
      if (res.ok || !isTransientStatus(res.status)) return res;
      // Transient 5xx — back off and retry, unless this was the last attempt.
      if (attempt === opts.attempts - 1) return res;
      const ra = parseRetryAfter(res.headers.get("retry-after"));
      const delay = ra ?? backoff(attempt, opts);
      await sleep(delay, options.signal);
      continue;
    } catch (err) {
      lastErr = err;
      // Network error — retry unless final attempt.
      if (attempt === opts.attempts - 1) throw err;
      await sleep(backoff(attempt, opts), options.signal);
    }
  }
  // Defensive — loop always returns or throws.
  throw lastErr ?? new Error("fetchWithRetry: exhausted");
}
