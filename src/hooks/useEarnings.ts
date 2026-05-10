import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { getUpcomingEarnings, type UpcomingEarnings } from "@/lib/earnings.functions";

/**
 * Upcoming earnings overlay. Polls Finnhub once an hour for the listed
 * symbols and returns a getter for each ticker's next earnings event
 * within `daysAhead` calendar days (default 60).
 */
export function useEarnings(symbols: string[], daysAhead = 60) {
  const fn = useServerFn(getUpcomingEarnings);
  const unique = useMemo(
    () => Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))).sort(),
    [symbols],
  );
  const key = unique.join(",");
  const { data } = useQuery({
    queryKey: ["earnings", key, daysAhead],
    queryFn: () => fn({ data: { symbols: unique, daysAhead } }),
    enabled: unique.length > 0,
    staleTime: 60 * 60 * 1000,        // 1h — earnings dates rarely change intraday
    refetchInterval: 60 * 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    retry: 0,
  });
  const map = data?.earnings ?? {};
  const get = (sym: string): UpcomingEarnings | null =>
    map[sym.toUpperCase()] ?? null;
  return { get, configured: data?.configured ?? false };
}
