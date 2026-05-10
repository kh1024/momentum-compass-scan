export interface ScannerRuntimeSettings {
  maxConcurrentRequests: number;
  quoteTtlMs: number;
  prevAggTtlMs: number;
  optionChainTtlMs: number;
  marketRegimeTtlMs: number;
  maxRetries: number;
  retryBackoffMaxMs: number;
  maxTickersPerScan: number;
  scanFinalistsOnlyForOptions: boolean;
  /**
   * Auto-refresh interval for the full scanner (rerunning contract selection).
   * 0 = manual only. UI exposes Off / 5 / 10 / 15 min presets.
   */
  fullScanIntervalMs: number;
}

const defaults: ScannerRuntimeSettings = {
  maxConcurrentRequests: 1,
  quoteTtlMs: 132_000,
  prevAggTtlMs: 33 * 60_000,
  optionChainTtlMs: 99_000,
  marketRegimeTtlMs: 330_000,
  maxRetries: 4,
  retryBackoffMaxMs: 33_000,
  maxTickersPerScan: 25,
  scanFinalistsOnlyForOptions: true,
  fullScanIntervalMs: 10 * 60_000,
};

let settings: ScannerRuntimeSettings = { ...defaults };

export function getScannerSettings(): ScannerRuntimeSettings {
  return { ...settings };
}

export function updateScannerSettings(next: Partial<ScannerRuntimeSettings>): ScannerRuntimeSettings {
  settings = {
    ...settings,
    ...next,
    maxConcurrentRequests: clampInt(next.maxConcurrentRequests ?? settings.maxConcurrentRequests, 1, 6),
    maxRetries: clampInt(next.maxRetries ?? settings.maxRetries, 0, 5),
    retryBackoffMaxMs: clampInt(next.retryBackoffMaxMs ?? settings.retryBackoffMaxMs, 1_000, 60_000),
    quoteTtlMs: clampInt(next.quoteTtlMs ?? settings.quoteTtlMs, 10_000, 30 * 60_000),
    prevAggTtlMs: clampInt(next.prevAggTtlMs ?? settings.prevAggTtlMs, 60_000, 24 * 60 * 60_000),
    optionChainTtlMs: clampInt(next.optionChainTtlMs ?? settings.optionChainTtlMs, 10_000, 10 * 60_000),
    marketRegimeTtlMs: clampInt(next.marketRegimeTtlMs ?? settings.marketRegimeTtlMs, 30_000, 10 * 60_000),
    maxTickersPerScan: clampInt(next.maxTickersPerScan ?? settings.maxTickersPerScan, 1, 50),
    scanFinalistsOnlyForOptions: next.scanFinalistsOnlyForOptions ?? settings.scanFinalistsOnlyForOptions,
    fullScanIntervalMs: clampFullScanInterval(next.fullScanIntervalMs ?? settings.fullScanIntervalMs),
  };
  return getScannerSettings();
}

function clampFullScanInterval(v: number): number {
  if (!isFinite(v) || v <= 0) return 0;
  return Math.min(Math.max(Math.round(v), 60_000), 60 * 60_000);
}

export function normalizeTickers(symbols: string[], max = 50): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const sym = raw.trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
    if (out.length >= max) break;
  }
  return out;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}