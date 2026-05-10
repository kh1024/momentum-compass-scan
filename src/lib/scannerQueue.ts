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
}

const defaults: ScannerRuntimeSettings = {
  maxConcurrentRequests: 5,
  quoteTtlMs: 60_000,
  prevAggTtlMs: 15 * 60_000,
  optionChainTtlMs: 45_000,
  marketRegimeTtlMs: 2 * 60_000,
  maxRetries: 3,
  retryBackoffMaxMs: 15_000,
  maxTickersPerScan: 23,
  scanFinalistsOnlyForOptions: true,
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
  };
  return getScannerSettings();
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