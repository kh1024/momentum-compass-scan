import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef } from "react";
import { getRedditSentiment, type RedditSignal } from "@/lib/reddit.functions";

interface UseRedditSentimentOptions {
  refetchIntervalMs?: number | false;
}

/**
 * Live Reddit sentiment overlay. Refreshes every 15 min (server caches 30 min,
 * so cheap polling). `get` is a STABLE reference (closed over a ref) so it
 * does not invalidate consumer memos on unrelated re-renders.
 */
export function useRedditSentiment(symbols: string[], options: UseRedditSentimentOptions = {}) {
  const fetchFn = useServerFn(getRedditSentiment);
  const refetchIntervalMs = options.refetchIntervalMs ?? 15 * 60_000;
  const unique = useMemo(
    () => Array.from(new Set(symbols.map(s => s.toUpperCase()))).sort(),
    [symbols],
  );
  const key = unique.join(",");

  const { data } = useQuery({
    queryKey: ["reddit-sentiment", key],
    queryFn: () => fetchFn({ data: { symbols: unique } }),
    enabled: unique.length > 0,
    refetchInterval: refetchIntervalMs,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime:
      typeof refetchIntervalMs === "number"
        ? Math.max(Math.min(refetchIntervalMs - 5_000, refetchIntervalMs), 60_000)
        : Infinity,
    retry: 0,
  });

  const signalsRef = useRef<Record<string, RedditSignal>>({});
  if (data?.signals) signalsRef.current = data.signals;
  const signals = signalsRef.current;

  const get = useCallback(
    (sym: string): RedditSignal | null => signalsRef.current[sym.toUpperCase()] ?? null,
    [],
  );

  return { get, signals };
}

