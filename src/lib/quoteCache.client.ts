/**
 * Client-side persistent cache for live quotes.
 *
 * Stale-while-revalidate: on cold start we read the last successful quote
 * payload from localStorage and seed react-query with it, so the UI shows
 * real data immediately while a fresh fetch hydrates in the background.
 *
 * Cache is keyed by the sorted symbol list so different watchlists / scans
 * don't clobber each other.
 */
export interface ConsensusQuote {
  symbol: string;
  price: number;
  change?: number;
  changePct?: number;
  prevClose?: number;
  ts?: number;
  source?: string;
  [k: string]: unknown;
}

const PREFIX = "lq:v1:";
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h — covers a long weekend

export interface CachedQuotePayload {
  quotes: Record<string, ConsensusQuote | null>;
  live: boolean;
  cooldownMs: number;
  massiveBlocked: boolean;
  /** When this payload was persisted (ms epoch). */
  savedAt: number;
}

function keyFor(symbolsKey: string): string {
  return PREFIX + symbolsKey;
}

function safeWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export function loadQuoteCache(symbolsKey: string): CachedQuotePayload | null {
  const w = safeWindow();
  if (!w) return null;
  try {
    const raw = w.localStorage.getItem(keyFor(symbolsKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedQuotePayload;
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveQuoteCache(
  symbolsKey: string,
  payload: Omit<CachedQuotePayload, "savedAt">,
): void {
  const w = safeWindow();
  if (!w) return;
  try {
    const data: CachedQuotePayload = { ...payload, savedAt: Date.now() };
    w.localStorage.setItem(keyFor(symbolsKey), JSON.stringify(data));
  } catch {
    // Quota or serialization failure — silent, cache is optional.
  }
}

/** Merge any cached payloads for the universal symbol set — used to seed lastGood. */
export function loadAllRecentQuotes(): Record<string, ConsensusQuote> {
  const w = safeWindow();
  if (!w) return {};
  const out: Record<string, ConsensusQuote> = {};
  try {
    for (let i = 0; i < w.localStorage.length; i++) {
      const k = w.localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      const raw = w.localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as CachedQuotePayload;
      if (!parsed || typeof parsed.savedAt !== "number") continue;
      if (Date.now() - parsed.savedAt > MAX_AGE_MS) continue;
      for (const [sym, q] of Object.entries(parsed.quotes)) {
        if (q && isFinite(q.price) && q.price > 0) {
          const u = sym.toUpperCase();
          // Keep freshest by ts.
          const prev = out[u];
          if (!prev || (q.ts ?? 0) > (prev.ts ?? 0)) out[u] = q;
        }
      }
    }
  } catch {
    // ignore
  }
  return out;
}
