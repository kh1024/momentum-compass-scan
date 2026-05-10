import { buildCacheKey, readApiCache, writeApiCache } from "./apiCache";
import { logApiHealth } from "./apiHealthLogger";
import { massiveLimiter } from "./rateLimiter";
import { getScannerSettings } from "./scannerQueue";
import { parseRetryAfterMs, retryWithBackoff } from "./retryWithBackoff";
import { recordThrottleSample } from "./dynamicThrottle";

const BASE = "https://api.massive.com";

export interface MassiveClientResult<T> {
  data: T | null;
  cached: boolean;
  retryCount: number;
  rateLimited: boolean;
  errorMessage: string | null;
}

export class MassiveClientRateLimitError extends Error {
  rateLimited = true as const;
  constructor(public retryAfterMs: number) {
    super("Rate limited by Massive. Retrying with backoff.");
    this.name = "MassiveClientRateLimitError";
  }
}

export async function massiveClient<T>(
  path: string,
  options: { ticker?: string; ttlMs?: number; cacheKey?: string; signal?: AbortSignal } = {},
): Promise<MassiveClientResult<T>> {
  const url = `${BASE}${path}`;
  const method = "GET";
  const key = options.cacheKey ?? buildCacheKey(["massive", path]);
  const ttlMs = options.ttlMs ?? getScannerSettings().quoteTtlMs;
  const start = Date.now();
  const cached = readApiCache<T>(key);
  if (cached) {
    logApiHealth({ endpoint: path, url, method, ticker: options.ticker ?? null, statusCode: 200, statusText: "OK (cache)", responseTimeMs: Date.now() - start, cached: true, retryCount: 0, rateLimited: false, errorMessage: null });
    return { data: cached.value, cached: true, retryCount: 0, rateLimited: false, errorMessage: null };
  }

  const keySecret = process.env.MASSIVE_API_KEY;
  if (!keySecret) throw new Error("MASSIVE_API_KEY not configured");

  let statusCode: number | null = null;
  let statusText: string | null = null;
  let retryAfterMs: number | null = null;
  let retryCount = 0;
  try {
    const result = await massiveLimiter.run(() => retryWithBackoff<Response>(async () => {
      retryCount += statusCode === 429 ? 1 : 0;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${keySecret}`, Accept: "application/json" },
        signal: options.signal,
      });
      statusCode = response.status;
      statusText = response.statusText;
      if (response.status === 429) {
        retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after")) ?? 0;
        const dt429 = Date.now() - start;
        recordThrottleSample("massive", dt429, { ok: false, rateLimited: true });
        logApiHealth({ endpoint: path, url, method, ticker: options.ticker ?? null, statusCode: 429, statusText: response.statusText || "Too Many Requests", retryAfterMs, responseTimeMs: dt429, cached: false, retryCount, rateLimited: true, errorMessage: `429 Too Many Requests on ${method} ${path}${retryAfterMs ? ` (retry-after ${retryAfterMs}ms)` : ""}` });
        throw new MassiveClientRateLimitError(retryAfterMs);
      }
      return response;
    }, { signal: options.signal }));
    retryCount = result.retryCount;
    const response = result.value;
    if (!response.ok) throw new Error(`Massive ${response.status} ${response.statusText} on ${method} ${path}`);
    const data = (await response.json()) as T;
    writeApiCache(key, data, ttlMs);
    const dtOk = Date.now() - start;
    recordThrottleSample("massive", dtOk, { ok: true });
    logApiHealth({ endpoint: path, url, method, ticker: options.ticker ?? null, statusCode: response.status, statusText: response.statusText, responseTimeMs: dtOk, cached: false, retryCount, rateLimited: false, errorMessage: null });
    return { data, cached: false, retryCount, rateLimited: false, errorMessage: null };
  } catch (error) {
    const rateLimited = Boolean(error && typeof error === "object" && (error as { rateLimited?: boolean }).rateLimited);
    const baseMessage = error instanceof Error ? error.message : String(error);
    const message = `${baseMessage} [${method} ${path}${statusCode ? ` → ${statusCode}${statusText ? ` ${statusText}` : ""}` : ""}]`;
    const dtErr = Date.now() - start;
    if (!rateLimited) recordThrottleSample("massive", dtErr, { ok: false });
    logApiHealth({ endpoint: path, url, method, ticker: options.ticker ?? null, statusCode, statusText, retryAfterMs, responseTimeMs: dtErr, cached: false, retryCount, rateLimited, errorMessage: message });
    return { data: null, cached: false, retryCount, rateLimited, errorMessage: rateLimited ? `Rate limited (429) on ${method} ${path}. Try again later or reduce ticker count.` : message };
  }
}