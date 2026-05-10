/**
 * useMarketQuotes — thin React Query hook over marketDataService.
 *
 * Components should call this instead of fetching quotes directly. Returns
 * a record of TrustEnvelope<Quote> keyed by symbol, plus the rollup status
 * for the trust strip.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchQuotesEnvelope } from "@/services/marketDataService";
import type { Quote } from "@/services/marketDataService";
import { rollupStatus, type DataStatus, type TrustEnvelope } from "@/services/trust";

export interface UseMarketQuotesResult {
  quotes: Record<string, TrustEnvelope<Quote>>;
  status: DataStatus;
  cooldownMs: number;
  isFetching: boolean;
  refetch: () => void;
}

export function useMarketQuotes(
  symbols: string[],
  opts: { refetchIntervalMs?: number; enabled?: boolean } = {},
): UseMarketQuotesResult {
  const { refetchIntervalMs = 60_000, enabled = true } = opts;
  const key = useMemo(() => [...symbols].sort(), [symbols]);

  const q = useQuery({
    queryKey: ["market-quotes", key],
    queryFn: () => fetchQuotesEnvelope(key),
    refetchInterval: refetchIntervalMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    enabled: enabled && key.length > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const quotes = q.data?.quotes ?? {};
  const status = rollupStatus(Object.values(quotes));
  return {
    quotes,
    status,
    cooldownMs: q.data?.cooldownMs ?? 0,
    isFetching: q.isFetching,
    refetch: () => void q.refetch(),
  };
}
