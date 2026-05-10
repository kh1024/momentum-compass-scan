/**
 * watchlistService — single source of truth for the watchlist data model.
 *
 * Persists to localStorage under `watchlist:v2`. Migrates legacy `watchlist:v1`
 * entries on first read by re-snapshotting their fields into the v2 schema.
 *
 * Each entry stores:
 *   - identity (ticker, direction, contract key)
 *   - the entry-time TrustEnvelope snapshot (so we know what data we trusted
 *     when the user added the pick — we never claim P/L against fabricated
 *     entry prices)
 *   - target / invalidation / thesis from the AI
 */

import type { TradeCandidate } from "@/lib/types";
import type { Quote } from "./marketDataService";
import type { TrustEnvelope } from "./trust";
import { wrap } from "./trust";

export interface WatchlistContractSnapshot {
  strike: number;
  expiration: string;
  type: "call" | "put";
  bid: number;
  ask: number;
  mark: number;
  breakevenMovePct: number;
  dte: number;
  occSymbol?: string;
}

export interface WatchlistEntry {
  /** Schema version of this row. */
  v: 2;
  id: string;
  ticker: string;
  direction: "CALL" | "PUT";
  setupType: string;
  label: string;
  addedAt: number;
  /** TrustEnvelope of the stock quote at add time. */
  entryQuote: TrustEnvelope<Quote>;
  /**
   * Convenience mirror of `entryQuote.value?.price`. Always derived from the
   * envelope on write. Read-only for consumers — never mutate directly.
   */
  entryStockPrice: number;
  /** Score the AI gave when added. */
  entryScore: number;
  entryThesis?: string;
  target1?: number;
  target2?: number;
  invalidation?: string;
  expectedMovePct?: number;
  contract?: WatchlistContractSnapshot;
  archivedAt?: number | null;
}

const STORAGE_KEY = "watchlist:v2";
const LEGACY_KEY_V1 = "watchlist:v1";

// ── storage primitives ──────────────────────────────────────────────────────

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function readRaw(): WatchlistEntry[] {
  if (typeof window === "undefined") return [];
  // Migrate v1 if present and v2 isn't yet.
  if (!window.localStorage.getItem(STORAGE_KEY)) {
    const legacy = safeParse<unknown[]>(window.localStorage.getItem(LEGACY_KEY_V1));
    if (Array.isArray(legacy)) {
      const migrated = legacy.map(migrateV1).filter((x): x is WatchlistEntry => x != null);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      } catch { /* ignore */ }
    }
  }
  const parsed = safeParse<WatchlistEntry[]>(window.localStorage.getItem(STORAGE_KEY));
  return Array.isArray(parsed) ? parsed : [];
}

function writeRaw(items: WatchlistEntry[]) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* ignore quota */ }
}

// ── v1 → v2 migration ──────────────────────────────────────────────────────

interface LegacyV1Entry {
  id?: string;
  ticker?: string;
  direction?: "CALL" | "PUT";
  setupType?: string;
  label?: string;
  addedAt?: number;
  entryStockPrice?: number;
  entryScore?: number;
  entryThesis?: string;
  target1?: number;
  target2?: number;
  invalidation?: string;
  expectedMovePct?: number;
  contract?: WatchlistContractSnapshot;
  archivedAt?: number | null;
}

function migrateV1(raw: unknown): WatchlistEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const v1 = raw as LegacyV1Entry;
  if (!v1.ticker || !v1.direction || !v1.id) return null;
  // Re-snapshot the legacy entry: we only have the price, no provenance, so
  // mark the envelope as a synthetic "computed" snapshot. The next live tick
  // will give the user a current quote envelope alongside this historical one.
  const entryQuote: TrustEnvelope<Quote> = wrap<Quote>({
    value: v1.entryStockPrice != null && Number.isFinite(v1.entryStockPrice)
      ? {
          symbol: v1.ticker,
          price: v1.entryStockPrice,
          change: 0,
          changePct: 0,
          volume: 0,
          ts: v1.addedAt ?? Date.now(),
          source: "legacy-v1",
          agreement: "single",
        }
      : null,
    source: "computed",
    fetchedAt: v1.addedAt ?? null,
    validated: v1.entryStockPrice != null && Number.isFinite(v1.entryStockPrice),
  });
  return {
    v: 2,
    id: v1.id,
    ticker: v1.ticker,
    direction: v1.direction,
    setupType: v1.setupType ?? "",
    label: v1.label ?? "",
    addedAt: v1.addedAt ?? Date.now(),
    entryQuote,
    entryStockPrice: v1.entryStockPrice ?? entryQuote.value?.price ?? 0,
    entryScore: v1.entryScore ?? 0,
    entryThesis: v1.entryThesis,
    target1: v1.target1,
    target2: v1.target2,
    invalidation: v1.invalidation,
    expectedMovePct: v1.expectedMovePct,
    contract: v1.contract,
    archivedAt: v1.archivedAt ?? null,
  };
}

// ── public API ──────────────────────────────────────────────────────────────

export function watchlistKey(t: Pick<TradeCandidate, "ticker" | "direction"> & { contract?: { strike?: number; expiration?: string } }): string {
  const k = t.contract;
  if (k?.strike && k?.expiration) return `${t.ticker}:${t.direction}:${k.strike}:${k.expiration}`;
  return `${t.ticker}:${t.direction}`;
}

export function snapshotFromCandidate(
  t: TradeCandidate,
  entryQuoteEnvelope?: TrustEnvelope<Quote>,
): WatchlistEntry {
  const c = t.contract;
  const fallbackQuote: TrustEnvelope<Quote> = wrap<Quote>({
    value: Number.isFinite(t.price) && t.price > 0
      ? {
          symbol: t.ticker,
          price: t.price,
          change: 0,
          changePct: 0,
          volume: 0,
          ts: Date.now(),
          source: "fallback-snapshot",
          agreement: "single",
        }
      : null,
    source: "computed",
    fetchedAt: Date.now(),
    validated: Number.isFinite(t.price) && t.price > 0,
  });
  return {
    v: 2,
    id: watchlistKey(t),
    ticker: t.ticker,
    direction: t.direction,
    setupType: t.setupType,
    label: t.label,
    addedAt: Date.now(),
    entryQuote: entryQuoteEnvelope ?? fallbackQuote,
    entryStockPrice: (entryQuoteEnvelope ?? fallbackQuote).value?.price ?? t.price ?? 0,
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

export const watchlistService = {
  list(): WatchlistEntry[] { return readRaw(); },

  has(id: string): boolean {
    return readRaw().some((x) => x.id === id && !x.archivedAt);
  },

  add(entry: WatchlistEntry) {
    const current = readRaw();
    const without = current.filter((x) => x.id !== entry.id);
    writeRaw([entry, ...without]);
    notifyChange();
  },

  remove(id: string) {
    writeRaw(readRaw().filter((x) => x.id !== id));
    notifyChange();
  },

  archive(id: string) {
    writeRaw(readRaw().map((x) => x.id === id ? { ...x, archivedAt: Date.now() } : x));
    notifyChange();
  },

  restore(id: string) {
    writeRaw(readRaw().map((x) => x.id === id ? { ...x, archivedAt: null } : x));
    notifyChange();
  },

  toggle(t: TradeCandidate, entryQuoteEnvelope?: TrustEnvelope<Quote>) {
    const id = watchlistKey(t);
    const cur = readRaw();
    if (cur.some((x) => x.id === id && !x.archivedAt)) {
      this.remove(id);
    } else {
      this.add(snapshotFromCandidate(t, entryQuoteEnvelope));
    }
  },
};

function notifyChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("watchlist:changed"));
  }
}

export const WATCHLIST_CHANGE_EVENT = "watchlist:changed";
