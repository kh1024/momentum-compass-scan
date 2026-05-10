import { useCallback, useEffect, useState } from "react";
import type { TradeCandidate } from "@/lib/types";

export interface WatchlistItem {
  id: string;
  ticker: string;
  direction: "CALL" | "PUT";
  setupType: string;
  label: string;
  // Snapshot at add time
  addedAt: number;
  entryStockPrice: number;
  entryScore: number;
  entryThesis?: string;
  // Targets / risk
  target1?: number;
  target2?: number;
  invalidation?: string;
  expectedMovePct?: number;
  // Contract snapshot
  contract?: {
    strike: number;
    expiration: string;
    type: "call" | "put";
    bid: number;
    ask: number;
    mark: number;
    breakevenMovePct: number;
    dte: number;
    occSymbol?: string;
  };
  // Optional: archived flag for "Removed / Archived" section
  archivedAt?: number | null;
}

const STORAGE_KEY = "watchlist:v1";

function read(): WatchlistItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: WatchlistItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore quota errors */
  }
}

/** Stable key: ticker + direction + strike + expiration (or just ticker+direction if no contract). */
export function watchlistKey(t: Pick<TradeCandidate, "ticker" | "direction"> & { contract?: { strike?: number; expiration?: string } }): string {
  const k = t.contract;
  if (k?.strike && k?.expiration) return `${t.ticker}:${t.direction}:${k.strike}:${k.expiration}`;
  return `${t.ticker}:${t.direction}`;
}

export function snapshotFromCandidate(t: TradeCandidate): WatchlistItem {
  const c = t.contract;
  return {
    id: watchlistKey(t),
    ticker: t.ticker,
    direction: t.direction,
    setupType: t.setupType,
    label: t.label,
    addedAt: Date.now(),
    entryStockPrice: t.price,
    entryScore: t.finalScore ?? t.score,
    entryThesis: t.thesis,
    target1: t.target1,
    target2: t.target2,
    invalidation: t.invalidation,
    contract: c
      ? {
          strike: c.strike,
          expiration: c.expiration,
          type: t.direction === "CALL" ? "call" : "put",
          bid: c.bid,
          ask: c.ask,
          mark: c.mid ?? (c.bid + c.ask) / 2,
          breakevenMovePct: c.breakevenMovePct,
          dte: c.dte,
          occSymbol: c.occSymbol,
        }
      : undefined,
    archivedAt: null,
  };
}

export function useWatchlist() {
  // Initialize empty so SSR and first client render agree. Hydrate from
  // localStorage in an effect — fixes the React #418 hydration mismatch
  // when WatchlistButton's active state differs between server and client.
  const [items, setItems] = useState<WatchlistItem[]>([]);

  useEffect(() => {
    setItems(read());
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setItems(read());
    };
    const onCustom = () => setItems(read());
    window.addEventListener("storage", onStorage);
    window.addEventListener("watchlist:changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("watchlist:changed", onCustom);
    };
  }, []);

  const persist = useCallback((next: WatchlistItem[]) => {
    write(next);
    setItems(next);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("watchlist:changed"));
    }
  }, []);

  const has = useCallback((id: string) => items.some((x) => x.id === id && !x.archivedAt), [items]);

  const add = useCallback((item: WatchlistItem) => {
    const current = read();
    const without = current.filter((x) => x.id !== item.id);
    persist([item, ...without]);
  }, [persist]);

  const remove = useCallback((id: string) => {
    const current = read();
    persist(current.filter((x) => x.id !== id));
  }, [persist]);

  const archive = useCallback((id: string) => {
    const current = read();
    persist(current.map((x) => (x.id === id ? { ...x, archivedAt: Date.now() } : x)));
  }, [persist]);

  const restore = useCallback((id: string) => {
    const current = read();
    persist(current.map((x) => (x.id === id ? { ...x, archivedAt: null } : x)));
  }, [persist]);

  const toggle = useCallback((t: TradeCandidate) => {
    const id = watchlistKey(t);
    if (has(id)) remove(id);
    else add(snapshotFromCandidate(t));
  }, [has, add, remove]);

  return { items, has, add, remove, archive, restore, toggle };
}
