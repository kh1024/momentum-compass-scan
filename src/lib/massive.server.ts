/**
 * Massive (Polygon-compatible) live data provider — server-only.
 * Reads MASSIVE_API_KEY from process.env at call time.
 */
import { recordRateLimit } from "./rateLimitLog.server";
import { readPersistedQuote, writePersistedQuote } from "./quoteCache.server";
import { recordCacheExpired, recordCacheHit, recordCacheMiss, recordCacheWrite } from "./cacheStats";
import { massiveClient } from "./massiveClient";
import { buildCacheKey } from "./apiCache";
import { getScannerSettings, normalizeTickers } from "./scannerQueue";
import { fetchFinnhubQuote } from "./finnhub.server";

const BASE = "https://api.massive.com";
const COOLDOWN_BASE_MS = 1_000;
const COOLDOWN_MAX_MS = 15_000;

let cooldownUntil = 0;
let consecutive429 = 0;
let snapshotDisabled = true; // default OFF — most plans don't include /v2/snapshot. Re-enabled by env override below.
let snapshotDisabledReason: string | null =
  "Snapshot endpoint disabled by default (plan-gated). Set MASSIVE_ENABLE_SNAPSHOT=1 to opt-in.";

if (process.env.MASSIVE_ENABLE_SNAPSHOT === "1") {
  snapshotDisabled = false;
  snapshotDisabledReason = null;
}

// ---- runtime enable/disable toggle ---------------------------------
// Massive provider is hard-disabled app-wide. Other providers (Public.com,
// Finnhub, etc.) handle quotes and option chains. setMassiveEnabled() is a
// no-op so existing Settings UI doesn't crash.
let massiveEnabled = false;
const RATE_LIMIT_PER_MIN = Number(process.env.MASSIVE_RATE_LIMIT_PER_MIN ?? 113);
const recentRequests: number[] = [];
function noteRequest() {
  const now = Date.now();
  recentRequests.push(now);
  while (recentRequests.length && recentRequests[0] < now - 60_000) recentRequests.shift();
}
export function getMassiveRequestsLastMinute(): number {
  const cutoff = Date.now() - 60_000;
  while (recentRequests.length && recentRequests[0] < cutoff) recentRequests.shift();
  return recentRequests.length;
}
export function isMassiveEnabled(): boolean { return false; }
export function setMassiveEnabled(_v: boolean): void { /* hard-disabled */ }
export function getMassiveRateLimitPerMin(): number { return RATE_LIMIT_PER_MIN; }

// ---- response cache --------------------------------------------------
// /prev and /snapshot TTLs are runtime-configurable from Settings.
interface CacheEntry { value: MassiveQuote | null; expiresAt: number; }
const quoteCache = new Map<string, CacheEntry>();

export class MassiveRateLimitError extends Error {
  rateLimited = true as const;
  retryAfterMs: number;
  retryAt: number;
  constructor(retryAfterMs: number) {
    super(`Massive is rate-limiting requests. Retrying in ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = "MassiveRateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.retryAt = Date.now() + retryAfterMs;
  }
}

export function isMassiveRateLimited(e: unknown): e is MassiveRateLimitError {
  return Boolean(e && typeof e === "object" && (e as { rateLimited?: boolean }).rateLimited);
}

export function getMassiveCooldownStatus(): {
  rateLimited: boolean;
  remainingMs: number;
  retryAt: number | null;
  snapshotDisabled: boolean;
  snapshotDisabledReason: string | null;
} {
  const remainingMs = Math.max(0, cooldownUntil - Date.now());
  return {
    rateLimited: remainingMs > 0,
    remainingMs,
    retryAt: remainingMs > 0 ? cooldownUntil : null,
    snapshotDisabled,
    snapshotDisabledReason,
  };
}

export class MassiveForbiddenError extends Error {
  forbidden = true as const;
  constructor(public path: string) {
    super(`Massive ${path} returned 403 — endpoint not on this plan.`);
    this.name = "MassiveForbiddenError";
  }
}

export function isMassiveForbidden(e: unknown): e is MassiveForbiddenError {
  return Boolean(e && typeof e === "object" && (e as { forbidden?: boolean }).forbidden);
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const sec = Number(h);
  if (isFinite(sec) && sec > 0) return Math.min(sec * 1000, COOLDOWN_MAX_MS);
  const date = Date.parse(h);
  if (isFinite(date)) return Math.max(0, Math.min(date - Date.now(), COOLDOWN_MAX_MS));
  return null;
}

function tripCooldown(retryAfterMs: number | null, context: string): never {
  consecutive429 = Math.min(consecutive429 + 1, 10);
  const backoff = Math.min(COOLDOWN_BASE_MS * 2 ** (consecutive429 - 1), COOLDOWN_MAX_MS);
  const wait = retryAfterMs ?? backoff;
  cooldownUntil = Date.now() + wait;
  recordRateLimit({
    provider: "massive",
    context,
    retryAfterMs: wait,
    retryAt: cooldownUntil,
    source: retryAfterMs != null ? "header" : "backoff",
  });
  throw new MassiveRateLimitError(cooldownUntil - Date.now());
}

function noteSuccess() {
  if (consecutive429 > 0) consecutive429 = 0;
}

export interface MassiveQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  ts: number;
  source: "massive" | "finnhub";
}

interface SnapshotResp {
  ticker?: {
    ticker: string;
    day?: { c?: number; o?: number; v?: number };
    prevDay?: { c?: number };
    lastTrade?: { p?: number; t?: number };
    todaysChange?: number;
    todaysChangePerc?: number;
    updated?: number;
  };
}

export function massiveConfigured(): boolean {
  // Massive provider is disabled app-wide. Always report unconfigured so
  // every gate falls back to other providers.
  return false;
}

async function callMassive(path: string): Promise<unknown> {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new Error("MASSIVE_API_KEY not configured");
  if (!massiveEnabled) throw new Error("Massive disabled in Settings");
  const remaining = Math.max(0, cooldownUntil - Date.now());
  if (remaining > 0) throw new MassiveRateLimitError(remaining);

  const result = await massiveClient<unknown>(path, {
    ticker: extractTicker(path) ?? undefined,
    ttlMs: path.includes("/prev") ? getScannerSettings().prevAggTtlMs : getScannerSettings().quoteTtlMs,
    cacheKey: buildCacheKey(["massive", path]),
  });
  if (!result.cached) noteRequest();
  if (result.rateLimited) tripCooldown(null, path);
  if (result.errorMessage?.includes("403")) {
    if (path.startsWith("/v2/snapshot")) {
      snapshotDisabled = true;
      snapshotDisabledReason = "Massive plan does not include /v2/snapshot — using /prev instead.";
      console.warn(`[massive] ${snapshotDisabledReason}`);
    }
    throw new MassiveForbiddenError(path);
  }
  if (!result.data) throw new Error(result.errorMessage ?? `Massive request failed: ${path}`);
  noteSuccess();
  return result.data;
}

function extractTicker(path: string): string | null {
  const aggs = path.match(/\/v2\/aggs\/ticker\/([^/]+)\//);
  if (aggs?.[1]) return decodeURIComponent(aggs[1]).toUpperCase();
  const snap = path.match(/\/tickers\/([^/?]+)/);
  if (snap?.[1]) return decodeURIComponent(snap[1]).toUpperCase();
  return null;
}

function readCache(sym: string): MassiveQuote | null | undefined {
  const e = quoteCache.get(sym);
  if (!e) { recordCacheMiss("l1_quote"); return undefined; }
  if (e.expiresAt < Date.now()) {
    quoteCache.delete(sym);
    recordCacheExpired("l1_quote");
    recordCacheMiss("l1_quote");
    return undefined;
  }
  recordCacheHit("l1_quote");
  return e.value;
}
/**
 * Two-tier read: L1 (in-memory) → L2 (Supabase). On L2 hit, hydrate L1.
 * Returns `undefined` on a true miss so callers know to hit the API.
 */
async function loadFromCache(sym: string): Promise<MassiveQuote | null | undefined> {
  const l1 = readCache(sym);
  if (l1 !== undefined) return l1;
  const l2 = await readPersistedQuote(sym);
  if (!l2) { recordCacheMiss("l2_quote"); return undefined; }
  // Rehydrate L1 with the persisted entry's remaining TTL.
  const remaining = Math.max(0, l2.expiresAt - Date.now());
  if (remaining === 0) { recordCacheExpired("l2_quote"); recordCacheMiss("l2_quote"); return undefined; }
  recordCacheHit("l2_quote");
  quoteCache.set(sym, { value: l2.value, expiresAt: l2.expiresAt });
  return l2.value;
}
function writeCache(sym: string, value: MassiveQuote | null, ttlMs: number) {
  const expiresAt = Date.now() + ttlMs;
  quoteCache.set(sym, { value, expiresAt });
  recordCacheWrite("l1_quote");
  writePersistedQuote(sym, value, expiresAt); // fire-and-forget L2 write
  recordCacheWrite("l2_quote");
}

/** Live snapshot quote — preferred. Falls back to /prev, then to Finnhub. */
export async function fetchMassiveQuote(symbol: string): Promise<MassiveQuote | null> {
  const sym = symbol.toUpperCase();

  // Cache hit (memory or persisted) short-circuits both endpoints.
  const cached = await loadFromCache(sym);
  if (cached !== undefined) return cached;

  if (snapshotDisabled) return prevDayFallback(sym);
  try {
    const d = (await callMassive(
      `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(sym)}`,
    )) as SnapshotResp;
    const t = d.ticker;
    const price = Number(t?.lastTrade?.p ?? t?.day?.c);
    if (!isFinite(price) || price <= 0) return prevDayFallback(sym);
    const change = Number(t?.todaysChange ?? 0);
    const changePct = Number(t?.todaysChangePerc ?? 0);
    const volume = Number(t?.day?.v ?? 0);
    const ts = Number(t?.lastTrade?.t ?? t?.updated ?? Date.now() * 1e6);
    const tsMs = ts > 1e15 ? Math.floor(ts / 1e6) : ts;
    const q: MassiveQuote = { symbol: sym, price, change, changePct, volume, ts: tsMs, source: "massive" };
    writeCache(sym, q, getScannerSettings().quoteTtlMs);
    return q;
  } catch (e) {
    if (isMassiveRateLimited(e)) return finnhubFallback(sym);
    if (isMassiveForbidden(e)) return prevDayFallback(sym);
    console.warn(`[massive] snapshot ${sym} failed`, e);
    return prevDayFallback(sym);
  }
}

async function prevDayFallback(sym: string): Promise<MassiveQuote | null> {
  const cached = await loadFromCache(sym);
  if (cached !== undefined) return cached;
  try {
    const d = (await callMassive(
      `/v2/aggs/ticker/${encodeURIComponent(sym)}/prev?adjusted=true`,
    )) as { results?: Array<{ c: number; o: number; v: number; t: number }> };
    const row = d.results?.[0];
    if (!row || !isFinite(row.c) || row.c <= 0) {
      // Massive responded but has no data — try Finnhub before giving up.
      return finnhubFallback(sym);
    }
    const change = row.c - row.o;
    const changePct = row.o ? (change / row.o) * 100 : 0;
    const q: MassiveQuote = {
      symbol: sym, price: row.c, change, changePct,
      volume: row.v ?? 0, ts: row.t ?? Date.now(), source: "massive",
    };
    writeCache(sym, q, getScannerSettings().prevAggTtlMs);
    return q;
  } catch (e) {
    if (isMassiveRateLimited(e) || isMassiveForbidden(e)) return finnhubFallback(sym);
    console.warn(`[massive] prev ${sym} failed`, e);
    return finnhubFallback(sym);
  }
}

/**
 * Last-resort live quote from Finnhub. Used when Massive rate-limits,
 * 401/403s, or returns no data. Cached with the same persisted store so
 * repeat calls don't burn either provider's quota. Returns null when
 * Finnhub is unconfigured or also fails.
 */
async function finnhubFallback(sym: string): Promise<MassiveQuote | null> {
  const fq = await fetchFinnhubQuote(sym);
  if (!fq) {
    // Cache the miss briefly so we don't hammer either provider.
    writeCache(sym, null, Math.min(60_000, getScannerSettings().prevAggTtlMs));
    return null;
  }
  const q: MassiveQuote = {
    symbol: sym,
    price: fq.c,
    change: fq.d,
    changePct: fq.dp,
    volume: 0, // Finnhub /quote doesn't return volume
    ts: fq.t > 0 ? fq.t * 1000 : Date.now(),
    source: "finnhub",
  };
  writeCache(sym, q, getScannerSettings().quoteTtlMs);
  return q;
}

/**
 * Serial batch fetch with cache + pacer.
 * - Cached symbols return instantly (no API call).
 * - Uncached symbols are paced ≥ MIN_REQUEST_SPACING_MS apart by callMassive.
 * - On cooldown, remaining symbols return null without burning quota.
 */
export async function fetchMassiveQuotes(symbols: string[]): Promise<Record<string, MassiveQuote | null>> {
  const out: Record<string, MassiveQuote | null> = {};
  const unique = normalizeTickers(symbols, getScannerSettings().maxTickersPerScan);
  for (const upper of unique) {
    if (getMassiveCooldownStatus().rateLimited) {
      // While rate-limited, only serve from cache (memory or persisted) — never call the API.
      const cached = await loadFromCache(upper);
      out[upper] = cached === undefined ? null : cached;
      continue;
    }
    out[upper] = await fetchMassiveQuote(upper);
  }
  return out;
}
