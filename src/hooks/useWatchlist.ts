import { useCallback, useEffect, useState } from "react";
import type { TradeCandidate } from "@/lib/types";
import {
  watchlistService,
  watchlistKey,
  snapshotFromCandidate,
  WATCHLIST_CHANGE_EVENT,
  type WatchlistEntry,
} from "@/services/watchlistService";
import type { Quote } from "@/services/marketDataService";
import type { TrustEnvelope } from "@/services/trust";

/**
 * Backwards-compatible WatchlistItem alias for legacy callers — the service
 * is the source of truth, this hook is just a React subscription.
 */
export type WatchlistItem = WatchlistEntry;

export { watchlistKey, snapshotFromCandidate };

export function useWatchlist() {
  // Initialize empty so SSR and first client render agree (fixes hydration).
  const [items, setItems] = useState<WatchlistEntry[]>([]);

  useEffect(() => {
    setItems(watchlistService.list());
    if (typeof window === "undefined") return;
    const onCustom = () => setItems(watchlistService.list());
    const onStorage = (e: StorageEvent) => {
      if (e.key === "watchlist:v2" || e.key === "watchlist:v1") {
        setItems(watchlistService.list());
      }
    };
    window.addEventListener(WATCHLIST_CHANGE_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(WATCHLIST_CHANGE_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const has = useCallback(
    (id: string) => items.some((x) => x.id === id && !x.archivedAt),
    [items],
  );

  const add = useCallback((entry: WatchlistEntry) => watchlistService.add(entry), []);
  const remove = useCallback((id: string) => watchlistService.remove(id), []);
  const archive = useCallback((id: string) => watchlistService.archive(id), []);
  const restore = useCallback((id: string) => watchlistService.restore(id), []);
  const toggle = useCallback(
    (t: TradeCandidate, entryQuoteEnvelope?: TrustEnvelope<Quote>) =>
      watchlistService.toggle(t, entryQuoteEnvelope),
    [],
  );

  return { items, has, add, remove, archive, restore, toggle };
}
