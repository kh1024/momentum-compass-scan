import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { getQuotes } from "@/lib/quote.functions";
import type { ConsensusQuote } from "@/lib/providers.server";
import { loadAllRecentQuotes, loadQuoteCache, saveQuoteCache } from "@/lib/quoteCache";

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
  // Seeded from localStorage on first render so cold-start shows cached prices
  // INSTANTLY while a fresh fetch hydrates in the background.
  const lastGood = useRef<Record<string, ConsensusQuote>>(loadAllRecentQuotes());
  const everLive = useRef(Object.keys(lastGood.current).length > 0);

  // Seed react-query with cached payload for this exact symbol set so the
  // first render already has `data` populated and `isLoading` is false.
  const cached = useMemo(() => (key ? loadQuoteCache(key) : null), [key]);

  const { data, isLoading } = useQuery({
    queryKey: ["live-quotes", key],
    queryFn: () => fetchQuotes({ data: { symbols: unique } }),
    enabled: unique.length > 0,
    initialData: cached
      ? {
          quotes: cached.quotes,
          live: cached.live,
          cooldownMs: cached.cooldownMs,
          massiveBlocked: cached.massiveBlocked,
        }
      : undefined,
    initialDataUpdatedAt: cached?.savedAt,
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
    refetchOnMount: "always",
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
  let mergedAny = false;
  for (const [sym, q] of Object.entries(fresh)) {
    if (q && isFinite(q.price) && q.price > 0) {
      lastGood.current[sym.toUpperCase()] = q;
      everLive.current = true;
      mergedAny = true;
    }
  }
  if (data?.live) everLive.current = true;

  // Persist successful payloads so the next cold start shows data immediately.
  useEffect(() => {
    if (!key || !data || !mergedAny) return;
    saveQuoteCache(key, {
      quotes: data.quotes,
      live: data.live,
      cooldownMs: data.cooldownMs,
      massiveBlocked: data.massiveBlocked,
    });
  }, [key, data, mergedAny]);

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

