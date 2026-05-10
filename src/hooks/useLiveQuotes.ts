import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef } from "react";
import { getQuotes } from "@/lib/quote.functions";
import type { ConsensusQuote } from "@/lib/providers.server";

/**
 * Live quote overlay across the app.
 * - Pulls consensus quotes (Yahoo + Stooq + any keyed providers) every 30s.
 * - Backs off automatically when any provider is in cooldown.
 * - Retains last-good quote per symbol across refetches so the UI never
 *   flips back to "demo" once a live price has been observed.
 */
export function useLiveQuotes(symbols: string[]) {
  const fetchQuotes = useServerFn(getQuotes);
  const unique = useMemo(
    () => Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))).sort(),
    [symbols],
  );
  const key = unique.join(",");

  // Sticky cache of last-good quotes — survives empty/failed refetches so we
  // don't oscillate between live ↔ demo when a single poll comes back empty.
  const lastGood = useRef<Record<string, ConsensusQuote>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["live-quotes", key],
    queryFn: () => fetchQuotes({ data: { symbols: unique } }),
    enabled: unique.length > 0,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.cooldownMs && d.cooldownMs > 0) {
        return Math.min(d.cooldownMs + 1_000, 10 * 60_000);
      }
      return 30_000;
    },
    refetchOnWindowFocus: (q) =>
      !(q.state.data?.cooldownMs && q.state.data.cooldownMs > 0),
    refetchOnMount: false,
    staleTime: 25_000,
    retry: (count, err) => {
      const msg = err instanceof Error ? err.message : "";
      if (/rate.?limit|429/i.test(msg)) return false;
      return count < 1;
    },
  });

  // Merge fresh successful quotes into the sticky cache.
  const fresh = data?.quotes ?? {};
  for (const [sym, q] of Object.entries(fresh)) {
    if (q && isFinite(q.price) && q.price > 0) {
      lastGood.current[sym.toUpperCase()] = q;
    }
  }

  const get = (sym: string): ConsensusQuote | null => {
    const u = sym.toUpperCase();
    return fresh[u] ?? lastGood.current[u] ?? null;
  };

  const anyLive =
    (data?.live ?? false) || Object.keys(lastGood.current).length > 0;

  return { get, quotes: fresh, isLoading, anyLive };
}
