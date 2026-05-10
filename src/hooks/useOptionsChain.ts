/**
 * useOptionsChain — React Query wrapper around optionsDataService.
 *
 * Returns TrustEnvelope per pick key plus the raw EnrichmentResult so legacy
 * callers (applyLiveChain, debug panes) keep working unchanged. UI surfaces
 * should prefer reading envelopes via `getEnvelope(key)`.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchOptionsChainEnvelopes,
  type EnrichedContract,
  type OptionsChainResult,
  type OptionsPickInput,
} from "@/services/optionsDataService";
import {
  rollupStatus,
  unavailable,
  type DataStatus,
  type TrustEnvelope,
} from "@/services/trust";
import { loadOptionsSnapshot, saveOptionsSnapshot } from "@/lib/scanSnapshot.client";

export interface UseOptionsChainResult {
  envelopes: Record<string, TrustEnvelope<EnrichedContract>>;
  raw: OptionsChainResult["raw"];
  status: DataStatus;
  rateLimited: boolean;
  retryInMs: number;
  retryAt: number | null;
  message: string | null;
  isFetching: boolean;
  error: unknown;
  dataUpdatedAt: number;
  refetch: () => void;
  /** Convenience: typed envelope getter (always returns one). */
  getEnvelope: (key: string) => TrustEnvelope<EnrichedContract>;
}

export function useOptionsChain(
  picks: OptionsPickInput[],
  opts: { enabled?: boolean; staleTime?: number; refetchInterval?: number | false } = {},
): UseOptionsChainResult {
  const { enabled = true, staleTime = 60 * 60_000, refetchInterval = false } = opts;

  const queryKey = useMemo(
    () =>
      picks
        .map(
          (p) =>
            `${p.ticker}:${p.direction}:${p.isLeaps ? 1 : 0}:${p.isYolo ? 1 : 0}:${p.entryMode ?? ""}:${p.targetStrike ?? ""}`,
        )
        .join(","),
    [picks],
  );

  const cachedSnapshot = useMemo(
    () => loadOptionsSnapshot<OptionsChainResult>(queryKey),
    [queryKey],
  );

  const q = useQuery({
    queryKey: ["options-chain", queryKey],
    queryFn: () => fetchOptionsChainEnvelopes(picks),
    enabled: enabled && picks.length > 0,
    initialData: cachedSnapshot?.result,
    initialDataUpdatedAt: cachedSnapshot?.savedAt,
    refetchInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime,
    // Stale-while-revalidate: keep showing the previous payload (or the
    // disk-cached snapshot) while a fresh fetch is in flight so the scanner
    // table never wipes mid-refresh.
    placeholderData: (prev) => prev ?? cachedSnapshot?.result,
  });

  // Persist verified results only. saveOptionsSnapshot internally rejects
  // empty / rate-limited payloads so a broken refresh can never overwrite
  // the last good snapshot.
  useEffect(() => {
    if (!q.data) return;
    saveOptionsSnapshot<OptionsChainResult>(queryKey, q.data);
  }, [q.data, queryKey]);

  const envelopes = q.data?.envelopes ?? {};
  const status = rollupStatus(Object.values(envelopes));

  const getEnvelope = (key: string): TrustEnvelope<EnrichedContract> =>
    envelopes[key] ?? unavailable<EnrichedContract>("no-chain", `No envelope for ${key}`);

  return {
    envelopes,
    raw:
      q.data?.raw ?? {
        enriched: {},
        live: false,
        rateLimited: false,
        retryInMs: 0,
        retryAt: null,
        message: null,
      },
    status,
    rateLimited: q.data?.rateLimited ?? false,
    retryInMs: q.data?.retryInMs ?? 0,
    retryAt: q.data?.retryAt ?? null,
    message: q.data?.message ?? null,
    isFetching: q.isFetching,
    error: q.error,
    dataUpdatedAt: q.dataUpdatedAt,
    refetch: () => void q.refetch(),
    getEnvelope,
  };
}
