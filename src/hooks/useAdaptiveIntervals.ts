import { useEffect, useState } from "react";
import { getAdaptiveIntervals, getMarketSession, type AdaptiveIntervals, type MarketSession } from "@/lib/marketHours";

/**
 * Hook returning market-aware refresh cadences.
 * Re-evaluates every 60s so transitions between sessions (e.g. open -> afterhours)
 * smoothly retune the polling cadence of dependent useQuery hooks.
 */
export function useAdaptiveIntervals(): AdaptiveIntervals & { session: MarketSession } {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => (n + 1) % 1_000_000), 60_000);
    return () => clearInterval(id);
  }, []);
  return { ...getAdaptiveIntervals(), session: getMarketSession() };
}
