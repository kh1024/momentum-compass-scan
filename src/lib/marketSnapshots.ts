/**
 * Client-side persistent snapshots for the market shell.
 *
 * Three independent buckets, each keyed under a stable storage key so the
 * dashboard can hydrate instantly on cold start:
 *   - quote snapshots — scoped by symbol-set (market / crypto / watchlist / scanner)
 *   - regime snapshot — single latest verified bias + index quotes
 *
 * Rules:
 *   - Never overwrite a good snapshot with empty/invalid data.
 *   - Snapshots are SSR-safe (no-op when window is undefined).
 *   - Each save records `savedAt` for "Latest verified Xm ago" labels.
 */
import type { ConsensusQuote } from "@/lib/quote-types";

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const QUOTE_PREFIX = "market:lastVerifiedQuotes:";
const REGIME_KEY = "market:lastVerifiedRegime";

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// ── Quote snapshots ──────────────────────────────────────────────────────────

export interface QuoteSnapshot {
  quotes: Record<string, ConsensusQuote>;
  savedAt: number;
  /** Optional scope label for debug — "market", "crypto", "watchlist", "scanner". */
  scope?: string;
}

/** Infer a stable bucket name from a symbol set. */
export function inferQuoteScope(symbols: string[]): string {
  const upper = symbols.map((s) => s.toUpperCase());
  const hasCrypto = upper.some((s) => /-USD$/.test(s) || ["BTC", "ETH", "SOL"].includes(s));
  const hasIndex = upper.some((s) => ["SPY", "QQQ", "SMH", "IWM", "DIA"].includes(s));
  if (hasCrypto && !hasIndex) return "crypto";
  if (hasIndex && upper.length <= 12) return "market";
  return `set:${upper.slice().sort().join(",")}`;
}

export function loadQuoteSnapshot(scope: string): QuoteSnapshot | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(QUOTE_PREFIX + scope);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuoteSnapshot;
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    if (!parsed.quotes || typeof parsed.quotes !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Merge fresh verified quotes into the persisted snapshot. Refuses empty payloads. */
export function saveQuoteSnapshot(
  scope: string,
  fresh: Record<string, ConsensusQuote | null | undefined>,
): boolean {
  const s = safeStorage();
  if (!s) return false;
  const valid: Record<string, ConsensusQuote> = {};
  for (const [sym, q] of Object.entries(fresh)) {
    if (q && Number.isFinite(q.price) && q.price > 0) {
      valid[sym.toUpperCase()] = q;
    }
  }
  if (Object.keys(valid).length === 0) return false;
  try {
    // Merge with prior so a partial refresh doesn't drop other symbols.
    const prior = loadQuoteSnapshot(scope);
    const merged: Record<string, ConsensusQuote> = { ...(prior?.quotes ?? {}), ...valid };
    const snap: QuoteSnapshot = { quotes: merged, savedAt: Date.now(), scope };
    s.setItem(QUOTE_PREFIX + scope, JSON.stringify(snap));
    return true;
  } catch {
    return false;
  }
}

// ── Regime snapshot ──────────────────────────────────────────────────────────

export interface RegimeSnapshot {
  bias: string;
  plainLabel?: string;
  spy?: ConsensusQuote | null;
  qqq?: ConsensusQuote | null;
  smh?: ConsensusQuote | null;
  commentary?: string;
  savedAt: number;
}

export function loadRegimeSnapshot(): RegimeSnapshot | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(REGIME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RegimeSnapshot;
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    if (!parsed.bias) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRegimeSnapshot(snap: Omit<RegimeSnapshot, "savedAt">): boolean {
  const s = safeStorage();
  if (!s) return false;
  // Don't overwrite a verified bias with "Unknown".
  if (!snap.bias || snap.bias === "Unknown") return false;
  // Need at least one verified index quote.
  const anyValid = [snap.spy, snap.qqq, snap.smh].some(
    (q) => q && Number.isFinite(q.price) && q.price > 0,
  );
  if (!anyValid) return false;
  try {
    const payload: RegimeSnapshot = { ...snap, savedAt: Date.now() };
    s.setItem(REGIME_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

// ── Health (Developer Mode) ──────────────────────────────────────────────────

export interface SnapshotHealthEntry {
  key: string;
  label: string;
  ageMs: number | null;
  count?: number;
}

export function readSnapshotHealth(): SnapshotHealthEntry[] {
  const s = safeStorage();
  if (!s) return [];
  const out: SnapshotHealthEntry[] = [];
  const now = Date.now();
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k) continue;
      if (k.startsWith(QUOTE_PREFIX)) {
        const raw = s.getItem(k);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as QuoteSnapshot;
          out.push({
            key: k,
            label: `Quotes · ${k.slice(QUOTE_PREFIX.length)}`,
            ageMs: parsed.savedAt ? now - parsed.savedAt : null,
            count: Object.keys(parsed.quotes ?? {}).length,
          });
        } catch {
          /* ignore */
        }
      } else if (k === REGIME_KEY) {
        const raw = s.getItem(k);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as RegimeSnapshot;
          out.push({
            key: k,
            label: `Regime · ${parsed.bias}`,
            ageMs: parsed.savedAt ? now - parsed.savedAt : null,
          });
        } catch {
          /* ignore */
        }
      } else if (k.startsWith("scanner:")) {
        const raw = s.getItem(k);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as { savedAt?: number };
          out.push({
            key: k,
            label: `Scanner · ${k.slice("scanner:".length).replace(/Snapshot:v1$/, "")}`,
            ageMs: parsed?.savedAt ? now - parsed.savedAt : null,
          });
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => (a.ageMs ?? Infinity) - (b.ageMs ?? Infinity));
}
