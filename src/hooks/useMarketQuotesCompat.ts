/**
 * useMarketQuotesCompat — bridge hook for legacy callers that expect a
 * ConsensusQuote-shaped value via `get(symbol)` plus an `anyLive` flag.
 *
 * Internally this delegates to `useMarketQuotes` (which goes through
 * `marketDataService` and TrustEnvelope rollups), then exposes:
 *   - get(sym): a ConsensusQuote-compatible object (or null)
 *   - anyLive: sticky live flag
 *   - quotes: raw envelopes (for trust UI)
 *   - status: rollup DataStatus
 *
 * This lets existing pipelines (applyLiveQuote, RegimeCard, CryptoCell) keep
 * working while every quote read is funneled through the trust layer.
 */

import { useCallback, useMemo, useRef } from "react";
import { useMarketQuotes } from "./useMarketQuotes";
import type { Quote } from "@/services/marketDataService";
import type { ConsensusQuote } from "@/lib/providers.server";
import type { DataStatus, TrustEnvelope } from "@/services/trust";
import type { SourceName } from "@/lib/providers.server";

function toConsensus(q: Quote): ConsensusQuote {
  return {
    symbol: q.symbol,
    price: q.price,
    change: q.change,
    changePct: q.changePct,
    volume: q.volume,
    ts: q.ts,
    consensusSource: q.consensusSource as SourceName,
    sources: q.sources as Partial<Record<SourceName, number>>,
    agreement: q.agreement,
    diffPct: q.diffPct,
  };
}

export interface UseMarketQuotesCompatResult {
  get: (sym: string) => ConsensusQuote | null;
  anyLive: boolean;
  quotes: Record<string, TrustEnvelope<Quote>>;
  status: DataStatus;
  cooldownMs: number;
  isFetching: boolean;
  refetch: () => void;
}

export function useMarketQuotesCompat(
  symbols: string[],
  opts: { refetchIntervalMs?: number; enabled?: boolean } = {},
): UseMarketQuotesCompatResult {
  const unique = useMemo(
    () =>
      Array.from(
        new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
      ).sort(),
    [symbols],
  );

  const { quotes, status, cooldownMs, isFetching, refetch } = useMarketQuotes(
    unique,
    opts,
  );

  // Sticky last-good cache so a single empty refetch doesn't flip the UI.
  const lastGood = useRef<Record<string, ConsensusQuote>>({});
  const everLive = useRef(false);

  for (const [sym, env] of Object.entries(quotes)) {
    if (env.value && env.validated) {
      lastGood.current[sym.toUpperCase()] = toConsensus(env.value);
      everLive.current = true;
    }
  }

  const get = useCallback((sym: string): ConsensusQuote | null => {
    return lastGood.current[sym.toUpperCase()] ?? null;
  }, []);

  const anyLive =
    everLive.current ||
    status === "live" ||
    status === "delayed";

  return { get, anyLive, quotes, status, cooldownMs, isFetching, refetch };
}
