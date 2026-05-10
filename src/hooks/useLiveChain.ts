import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef } from "react";
import { enrichWithPublicChain, type EnrichedContract } from "@/lib/chain.functions";
import type { Direction, EntryMode } from "@/lib/types";
import { chainPickKey } from "@/lib/chainKeys";

export interface ChainPick {
  ticker: string;
  direction: Direction;
  isLeaps?: boolean;
  isYolo?: boolean;
  entryMode?: EntryMode;
  targetStrike?: number;
}

/**
 * Multi-pick option-chain enrichment with sticky last-good cache.
 * - Pulls live contracts (strike, expiration, greeks) for the given picks.
 * - Polls every 90s; honors `retryInMs` when rate-limited.
 * - Keeps the last-good `EnrichedContract` per `ticker:direction` so a
 *   transient empty response doesn't blank cards back to demo.
 */
export function useLiveChain(picks: ChainPick[]) {
  const enrich = useServerFn(enrichWithPublicChain);

  // Stable, deduped key
  const norm = useMemo(() => {
    const seen = new Set<string>();
    const out: ChainPick[] = [];
    for (const p of picks) {
      const t = p.ticker.trim().toUpperCase();
      // Dedupe must include isLeaps/isYolo — otherwise a LEAPS NVDA CALL is
      // dropped when a short-term NVDA CALL appears first, and the LEAPS
      // section never receives a verified contract from the chain.
      const k = `${t}:${p.direction}:${p.isLeaps ? "L" : ""}${p.isYolo ? "Y" : ""}:${p.entryMode ?? ""}`;
      if (!t || seen.has(k)) continue;
      seen.add(k);
      out.push({ ticker: t, direction: p.direction, isLeaps: p.isLeaps, isYolo: p.isYolo, entryMode: p.entryMode, targetStrike: p.targetStrike });
    }
    out.sort((a, b) => (a.ticker + a.direction).localeCompare(b.ticker + b.direction));
    return out;
  }, [picks]);

  const queryKey = useMemo(
    () => norm.map((p) => `${p.ticker}:${p.direction}:${p.isLeaps ? "L" : ""}${p.isYolo ? "Y" : ""}:${p.entryMode ?? ""}:${p.targetStrike ?? ""}`).join(","),
    [norm],
  );

  const sticky = useRef<Record<string, EnrichedContract>>({});

  const { data } = useQuery({
    queryKey: ["live-chain", queryKey],
    queryFn: () => enrich({ data: { picks: norm } }),
    enabled: norm.length > 0,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.rateLimited && d.retryInMs > 0) {
        return Math.min(d.retryInMs + 1_000, 10 * 60_000);
      }
      return 90_000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    retry: (count, err) => {
      const msg = err instanceof Error ? err.message : "";
      if (/rate.?limit|429/i.test(msg)) return false;
      return count < 1;
    },
  });

  // Merge fresh non-null enrichments into the sticky cache.
  const fresh = data?.enriched ?? {};
  for (const [ticker, ec] of Object.entries(fresh)) {
    if (ec) sticky.current[ticker] = ec;
  }

  const getContract = (ticker: string, direction: Direction, opts?: { isLeaps?: boolean; isYolo?: boolean; entryMode?: EntryMode }): EnrichedContract | null => {
    const key = chainPickKey(ticker, direction, opts);
    return fresh[key] ?? sticky.current[key] ?? null;
  };

  const anyLive = (data?.live ?? false) || Object.keys(sticky.current).length > 0;
  return {
    getContract,
    anyLive,
    rateLimited: !!data?.rateLimited,
    retryInMs: data?.retryInMs ?? 0,
    message: data?.message ?? null,
  };
}
