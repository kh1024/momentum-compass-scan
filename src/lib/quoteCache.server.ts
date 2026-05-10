/**
 * Persistent quote cache for the Massive provider — server-only.
 * Backed by Supabase (`public.massive_quote_cache`) with service-role access.
 * Survives process restarts so /v2/aggs/.../prev results don't burn quota
 * on every cold boot.
 *
 * Writes are fire-and-forget: they never block the caller. Read failures
 * fall back to a cache miss so the request can still proceed.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { MassiveQuote } from "./massive.server";

const TABLE = "massive_quote_cache";

export interface PersistedCacheEntry {
  value: MassiveQuote | null;
  expiresAt: number;
}

/**
 * Persisted L2 cache TTL override (ms). When set, takes precedence over
 * the caller-supplied TTL for both writes (clamped to override) and reads
 * (entries are considered fresh up to `cached_at + override`).
 *
 * Configure via env vars (checked in order):
 *   MASSIVE_QUOTE_CACHE_TTL_MS    — raw milliseconds
 *   MASSIVE_QUOTE_CACHE_TTL_HOURS — hours (e.g. "6" for 6h)
 *
 * Returns null when no override is configured (caller TTL is used as-is).
 */
export function getPersistedTtlOverrideMs(): number | null {
  const raw = process.env.MASSIVE_QUOTE_CACHE_TTL_MS;
  if (raw) {
    const n = Number(raw);
    if (isFinite(n) && n > 0) return n;
  }
  const hrs = process.env.MASSIVE_QUOTE_CACHE_TTL_HOURS;
  if (hrs) {
    const n = Number(hrs);
    if (isFinite(n) && n > 0) return n * 60 * 60 * 1000;
  }
  return null;
}

export async function readPersistedQuote(symbol: string): Promise<PersistedCacheEntry | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("value, expires_at, cached_at")
      .eq("symbol", symbol)
      .maybeSingle();
    if (error || !data) return null;
    let expiresAt = new Date(data.expires_at).getTime();
    // Apply env-var override against cached_at so retention can be tuned
    // without rewriting rows.
    const override = getPersistedTtlOverrideMs();
    if (override !== null && data.cached_at) {
      const cachedAt = new Date(data.cached_at).getTime();
      if (isFinite(cachedAt)) expiresAt = cachedAt + override;
    }
    if (!isFinite(expiresAt) || expiresAt < Date.now()) return null;
    return { value: (data.value as MassiveQuote | null) ?? null, expiresAt };
  } catch (e) {
    console.warn("[quoteCache] read failed", e);
    return null;
  }
}

export function writePersistedQuote(
  symbol: string,
  value: MassiveQuote | null,
  expiresAt: number,
): void {
  const now = Date.now();
  const override = getPersistedTtlOverrideMs();
  const effectiveExpiresAt = override !== null ? now + override : expiresAt;
  // Fire-and-forget — never await, never throw.
  void supabaseAdmin
    .from(TABLE)
    .upsert(
      {
        symbol,
        // value is JSON-serializable (MassiveQuote is plain primitives)
        value: value as never,
        expires_at: new Date(effectiveExpiresAt).toISOString(),
        cached_at: new Date(now).toISOString(),
      },
      { onConflict: "symbol" },
    )
    .then(({ error }) => {
      if (error) console.warn(`[quoteCache] write ${symbol} failed`, error.message);
    });
}

/** Best-effort cleanup of expired rows. Safe to call periodically. */
export async function purgeExpiredQuotes(): Promise<number> {
  try {
    const { count, error } = await supabaseAdmin
      .from(TABLE)
      .delete({ count: "exact" })
      .lt("expires_at", new Date().toISOString());
    if (error) {
      console.warn("[quoteCache] purge failed", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (e) {
    console.warn("[quoteCache] purge error", e);
    return 0;
  }
}
