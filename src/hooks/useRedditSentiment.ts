import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { getRedditSentiment, type RedditSignal } from "@/lib/reddit.functions";

/**
 * Live Reddit sentiment overlay. Refreshes every 15 min (server caches 30 min,
 * so cheap polling). Always succeeds — returns an empty map on any failure.
 */
export function useRedditSentiment(symbols: string[]) {
  const fetchFn = useServerFn(getRedditSentiment);
  const unique = useMemo(
    () => Array.from(new Set(symbols.map(s => s.toUpperCase()))).sort(),
    [symbols],
  );
  const key = unique.join(",");

  const { data } = useQuery({
    queryKey: ["reddit-sentiment", key],
    queryFn: () => fetchFn({ data: { symbols: unique } }),
    enabled: unique.length > 0,
    refetchInterval: 15 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 10 * 60_000,
    retry: 0,
  });

  const signals = data?.signals ?? {};
  const get = (sym: string): RedditSignal | null =>
    signals[sym.toUpperCase()] ?? null;

  return { get, signals };
}
