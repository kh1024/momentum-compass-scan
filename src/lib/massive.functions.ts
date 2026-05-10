import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  massiveConfigured,
  isMassiveEnabled,
  setMassiveEnabled,
  getMassiveCooldownStatus,
  getMassiveRequestsLastMinute,
  getMassiveRateLimitPerMin,
} from "./massive.server";
import { getScannerSettings, updateScannerSettings, type ScannerRuntimeSettings } from "./scannerQueue";
import { getApiHealthEvents, clearApiHealthEvents, type ApiHealthEvent } from "./apiHealthLogger";
import { getRateLimitEvents, clearRateLimitEvents, type RateLimitEvent } from "./rateLimitLog.server";
import { getCacheStats, resetCacheStats, type CacheStatsSnapshot } from "./cacheStats";
import { getAllThrottleSnapshots, resetThrottle, type ThrottleSnapshot } from "./dynamicThrottle";

export interface MassiveStatus {
  configured: boolean;
  enabled: boolean;
  rateLimited: boolean;
  remainingMs: number;
  snapshotDisabled: boolean;
  snapshotDisabledReason: string | null;
  requestsLastMinute: number;
  rateLimitPerMin: number;
}

export const getMassiveStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<MassiveStatus> => {
    const c = getMassiveCooldownStatus();
    return {
      configured: massiveConfigured(),
      enabled: isMassiveEnabled(),
      rateLimited: c.rateLimited,
      remainingMs: c.remainingMs,
      snapshotDisabled: c.snapshotDisabled,
      snapshotDisabledReason: c.snapshotDisabledReason,
      requestsLastMinute: getMassiveRequestsLastMinute(),
      rateLimitPerMin: getMassiveRateLimitPerMin(),
    };
  },
);

export const setMassiveEnabledFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ enabled: z.boolean() }).parse(data))
  .handler(async ({ data }): Promise<MassiveStatus> => {
    setMassiveEnabled(data.enabled);
    const c = getMassiveCooldownStatus();
    return {
      configured: massiveConfigured(),
      enabled: isMassiveEnabled(),
      rateLimited: c.rateLimited,
      remainingMs: c.remainingMs,
      snapshotDisabled: c.snapshotDisabled,
      snapshotDisabledReason: c.snapshotDisabledReason,
      requestsLastMinute: getMassiveRequestsLastMinute(),
      rateLimitPerMin: getMassiveRateLimitPerMin(),
    };
  });

export const getRateLimitLog = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ events: RateLimitEvent[] }> => {
    return { events: getRateLimitEvents(50) };
  },
);

export const clearRateLimitLog = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    clearRateLimitEvents();
    return { ok: true };
  },
);

export const getScannerSettingsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<ScannerRuntimeSettings> => getScannerSettings(),
);

const SettingsInput = z.object({
  maxConcurrentRequests: z.number().min(1).max(6).optional(),
  quoteTtlMs: z.number().min(10_000).max(30 * 60_000).optional(),
  prevAggTtlMs: z.number().min(60_000).max(24 * 60 * 60_000).optional(),
  optionChainTtlMs: z.number().min(10_000).max(10 * 60_000).optional(),
  marketRegimeTtlMs: z.number().min(30_000).max(10 * 60_000).optional(),
  maxRetries: z.number().min(0).max(5).optional(),
  retryBackoffMaxMs: z.number().min(1_000).max(60_000).optional(),
  maxTickersPerScan: z.number().min(1).max(50).optional(),
  scanFinalistsOnlyForOptions: z.boolean().optional(),
  fullScanIntervalMs: z.number().min(0).max(60 * 60_000).optional(),
});

export const updateScannerSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => SettingsInput.parse(data))
  .handler(async ({ data }): Promise<ScannerRuntimeSettings> => updateScannerSettings(data));

export const getApiHealthLog = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ events: ApiHealthEvent[] }> => ({ events: getApiHealthEvents(100) }),
);

export const clearApiHealthLog = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    clearApiHealthEvents();
    return { ok: true };
  },
);

export const getCacheStatsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<CacheStatsSnapshot> => getCacheStats(),
);

export const resetCacheStatsFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    resetCacheStats();
    return { ok: true };
  },
);
