/**
 * useOptionsChain — React Query wrapper around optionsDataService.
 *
 * Returns TrustEnvelope per pick key plus the raw EnrichmentResult so legacy
 * callers (applyLiveChain, debug panes) keep working unchanged. UI surfaces
 * should prefer reading envelopes via `getEnvelope(key)`.
 */

import { useMemo } from "react";
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

  const q = useQuery({
    queryKey: ["options-chain", queryKey],
    queryFn: () => fetchOptionsChainEnvelopes(picks),
    enabled: enabled && picks.length > 0,
    refetchInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime,
    placeholderData: (prev) => prev,
  });

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
