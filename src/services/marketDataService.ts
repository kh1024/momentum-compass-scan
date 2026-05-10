/**
 * marketDataService — single entry point for quotes/regime data.
 *
 * Wraps the existing `getQuotes` server function and emits TrustEnvelopes so
 * the UI never sees a raw quote without provenance + freshness metadata.
 *
 * NOTE: Server-only consumers can call `fetchQuotesEnvelope` directly. UI
 * code should go through the React Query hook `useMarketQuotes` (added in a
 * follow-up file).
 */

import { getQuotes } from "@/lib/quote.functions";
import type { TrustEnvelope, DataSource } from "./trust";
import { wrap, errored, unavailable } from "./trust";

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  ts: number;
  /** Primary consensus provider for this quote. */
  consensusSource: string;
  /** Per-provider prices used to derive consensus. */
  sources: Partial<Record<string, number>>;
  agreement: "verified" | "close" | "mismatch" | "single";
  diffPct: number | null;
}

function mapSourceName(s: string): DataSource {
  if (s === "yahoo" || s === "stooq" || s === "finnhub") return s;
  if (s === "massive") return "computed";
  return null;
}

function validateQuote(q: Quote | null): q is Quote {
  if (!q) return false;
  if (!Number.isFinite(q.price) || q.price <= 0) return false;
  if (!Number.isFinite(q.changePct)) return false;
  return true;
}

export async function fetchQuotesEnvelope(
  symbols: string[],
): Promise<{
  quotes: Record<string, TrustEnvelope<Quote>>;
  live: boolean;
  cooldownMs: number;
}> {
  if (symbols.length === 0) {
    return { quotes: {}, live: false, cooldownMs: 0 };
  }
  try {
    const res = await getQuotes({ data: { symbols } });
    const out: Record<string, TrustEnvelope<Quote>> = {};
    for (const sym of symbols) {
      const raw = res.quotes[sym] ?? null;
      if (!raw) {
        out[sym] = unavailable<Quote>("no-data", `No quote returned for ${sym}`);
        continue;
      }
      const q: Quote = {
        symbol: raw.symbol,
        price: raw.price,
        change: raw.change,
        changePct: raw.changePct,
        volume: raw.volume,
        ts: raw.ts,
        consensusSource: raw.consensusSource,
        sources: raw.sources,
        agreement: raw.agreement,
        diffPct: raw.diffPct,
      };
      const validated = validateQuote(q);
      out[sym] = wrap<Quote>({
        value: validated ? q : null,
        source: mapSourceName(raw.consensusSource),
        fetchedAt: raw.ts || Date.now(),
        validated,
      });
    }
    return { quotes: out, live: res.live, cooldownMs: res.cooldownMs };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const out: Record<string, TrustEnvelope<Quote>> = {};
    for (const sym of symbols) {
      out[sym] = errored<Quote>("provider-error", msg);
    }
    return { quotes: out, live: false, cooldownMs: 0 };
  }
}
