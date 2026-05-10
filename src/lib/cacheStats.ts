/**
 * Cache hit/miss counters — server-side, in-memory.
 * Tracks the L1 (in-process) Massive quote cache, L2 (persisted Supabase)
 * quote cache, the generic apiCache (used by aggs prev-day and option chains),
 * and write counts. Resets when the worker restarts.
 */

export type CacheLayer = "l1_quote" | "l2_quote" | "api_cache";

interface LayerStats {
  hits: number;
  misses: number;
  writes: number;
  expired: number;
  lastHitAt: number | null;
  lastMissAt: number | null;
}

function newLayer(): LayerStats {
  return { hits: 0, misses: 0, writes: 0, expired: 0, lastHitAt: null, lastMissAt: null };
}

const stats: Record<CacheLayer, LayerStats> = {
  l1_quote: newLayer(),
  l2_quote: newLayer(),
  api_cache: newLayer(),
};

const startedAt = Date.now();

export function recordCacheHit(layer: CacheLayer): void {
  stats[layer].hits += 1;
  stats[layer].lastHitAt = Date.now();
}

export function recordCacheMiss(layer: CacheLayer): void {
  stats[layer].misses += 1;
  stats[layer].lastMissAt = Date.now();
}

export function recordCacheWrite(layer: CacheLayer): void {
  stats[layer].writes += 1;
}

export function recordCacheExpired(layer: CacheLayer): void {
  stats[layer].expired += 1;
}

export interface CacheStatsSnapshot {
  startedAt: number;
  uptimeMs: number;
  layers: Record<CacheLayer, LayerStats & { hitRate: number; total: number }>;
}

export function getCacheStats(): CacheStatsSnapshot {
  const layers = {} as CacheStatsSnapshot["layers"];
  for (const key of Object.keys(stats) as CacheLayer[]) {
    const s = stats[key];
    const total = s.hits + s.misses;
    layers[key] = { ...s, total, hitRate: total === 0 ? 0 : s.hits / total };
  }
  return { startedAt, uptimeMs: Date.now() - startedAt, layers };
}

export function resetCacheStats(): void {
  for (const key of Object.keys(stats) as CacheLayer[]) stats[key] = newLayer();
}
