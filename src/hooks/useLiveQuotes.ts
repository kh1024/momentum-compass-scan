import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { getQuotes } from "@/lib/quote.functions";
import type { ConsensusQuote } from "@/lib/providers.server";
import { loadAllRecentQuotes, loadQuoteCache, saveQuoteCache } from "@/lib/quoteCache.client";

interface UseLiveQuotesOptions {
  refetchIntervalMs?: number | false;
}

/**
 * Live quote overlay across the app.
 * - Pulls consensus quotes (Yahoo + Stooq + any keyed providers) every 30s.
 * - Backs off automatically when any provider is in cooldown.
 * - Retains last-good quote per symbol across refetches so the UI never
 *   flips back to "demo" once a live price has been observed.
 * - `get` and `anyLive` are STABLE references (closed over a ref) so consumers
 *   that depend on them don't re-render every tick.
 */
export function useLiveQuotes(symbols: string[], options: UseLiveQuotesOptions = {}) {
  const fetchQuotes = useServerFn(getQuotes);
  const queryClient = useQueryClient();
  const refetchIntervalMs = options.refetchIntervalMs ?? 30_000;
  const unique = useMemo(
    () => Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))).sort(),
    [symbols],
  );
  const key = unique.join(",");

  // Sticky cache of last-good quotes — survives empty/failed refetches so we
  // don't oscillate between live ↔ demo when a single poll comes back empty.
  const lastGood = useRef<Record<string, ConsensusQuote>>({});
  const everLive = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ["live-quotes", key],
    queryFn: () => fetchQuotes({ data: { symbols: unique } }),
    enabled: unique.length > 0,
    refetchInterval: refetchIntervalMs === false ? false : (q) => {
      const d = q.state.data;
      if (d?.cooldownMs && d.cooldownMs > 0) {
        return Math.min(d.cooldownMs + 1_000, 10 * 60_000);
      }
      return refetchIntervalMs;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (q) =>
      !(q.state.data?.cooldownMs && q.state.data.cooldownMs > 0),
    refetchOnMount: false,
    // Keep showing previous data while a new key/payload is in flight to avoid
    // table flicker when symbols/filters change.
    placeholderData: (prev) => prev,
    staleTime:
      typeof refetchIntervalMs === "number"
        ? Math.max(Math.min(refetchIntervalMs - 5_000, refetchIntervalMs), 25_000)
        : Infinity,
    retry: (count, err) => {
      const msg = err instanceof Error ? err.message : "";
      if (/rate.?limit|429/i.test(msg)) return false;
      return count < 1;
    },
  });

  // Merge fresh successful quotes into the sticky cache (mutation in render
  // is intentional — `lastGood` is a ref, not state, and merging here keeps
  // get() consistent with the latest data without an extra render pass).
  const fresh = data?.quotes ?? {};
  for (const [sym, q] of Object.entries(fresh)) {
    if (q && isFinite(q.price) && q.price > 0) {
      lastGood.current[sym.toUpperCase()] = q;
      everLive.current = true;
    }
  }
  if (data?.live) everLive.current = true;

  // STABLE: identity never changes. Consumers can include this in useMemo
  // deps without invalidating the memo on every render.
  const get = useCallback((sym: string): ConsensusQuote | null => {
    const u = sym.toUpperCase();
    return lastGood.current[u] ?? null;
  }, []);

  // Once we've ever seen live data, stay "live" — prevents Live/Stale flicker.
  const anyLive = everLive.current || (data?.live ?? false);

  useEffect(() => {
    const regimeSymbols = ["SPY", "QQQ", "SMH"] as const;
    if (!regimeSymbols.every((sym) => unique.includes(sym))) return;

    const quotes = Object.fromEntries(
      regimeSymbols.map((sym) => [sym, lastGood.current[sym] ?? null]),
    );

    queryClient.setQueryData(["regime-quotes"], {
      quotes,
      live: regimeSymbols.some((sym) => Boolean(lastGood.current[sym])),
      cooldownMs: data?.cooldownMs ?? 0,
      massiveBlocked: data?.massiveBlocked ?? false,
    });
  }, [data?.cooldownMs, data?.massiveBlocked, queryClient, unique, anyLive]);

  return { get, quotes: fresh, isLoading, anyLive };
}

