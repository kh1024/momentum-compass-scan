import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { enrichWithPublicChain } from "@/lib/chain.functions";
import type { Direction } from "@/lib/types";
import { chainPickKey } from "@/lib/chainKeys";

/**
 * Fetch a live option contract (strike, expiration, greeks) for a single
 * ticker/direction via the Public.com chain enrichment server fn.
 * - Polls every 90s while live; backs off to the cooldown window when rate-limited.
 */
export function useLiveContract(
  ticker: string,
  direction: Direction,
  opts?: { isLeaps?: boolean; isYolo?: boolean },
) {
  const enrich = useServerFn(enrichWithPublicChain);
  const sym = ticker.trim().toUpperCase();

  const { data } = useQuery({
    queryKey: ["live-contract", sym, direction, !!opts?.isLeaps, !!opts?.isYolo],
    queryFn: () =>
      enrich({
        data: {
          picks: [{ ticker: sym, direction, isLeaps: opts?.isLeaps, isYolo: opts?.isYolo }],
        },
      }),
    enabled: !!sym,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.rateLimited && d.retryInMs > 0) {
        return Math.min(d.retryInMs + 1_000, 10 * 60_000);
      }
      return 90_000;
    },
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    retry: (count, err) => {
      const msg = err instanceof Error ? err.message : "";
      if (/rate.?limit|429/i.test(msg)) return false;
      return count < 1;
    },
  });

  const enriched = data?.enriched?.[chainPickKey(sym, direction, opts)] ?? null;
  return {
    contract: enriched?.contract ?? null,
    underlyingPrice: enriched?.underlyingPrice ?? null,
    isLive: !!enriched,
    rateLimited: !!data?.rateLimited,
    message: data?.message ?? null,
  };
}
