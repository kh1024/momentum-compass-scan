import { recordCacheExpired, recordCacheHit, recordCacheMiss, recordCacheWrite } from "./cacheStats";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  cachedAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

export function buildCacheKey(parts: Array<string | number | boolean | null | undefined>): string {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== "")
    .map((part) => String(part).trim().toUpperCase())
    .join(":");
}

export function readApiCache<T>(key: string): { value: T; cachedAt: number; expiresAt: number } | null {
  const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    recordCacheMiss("api_cache");
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    recordCacheExpired("api_cache");
    recordCacheMiss("api_cache");
    return null;
  }
  recordCacheHit("api_cache");
  return entry;
}

export function writeApiCache<T>(key: string, value: T, ttlMs: number): void {
  memoryCache.set(key, { value, cachedAt: Date.now(), expiresAt: Date.now() + ttlMs });
  recordCacheWrite("api_cache");
}

export function clearApiCache(prefix?: string): void {
  if (!prefix) {
    memoryCache.clear();
    return;
  }
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }
}