/**
 * Quote Validation Layer
 * ----------------------
 * Single source of truth that decides whether a quote can drive the scanner.
 *
 * Failure modes we explicitly catch BEFORE a price reaches the scanner:
 *   - missing / non-numeric / non-finite price
 *   - price <= 0
 *   - missing timestamp
 *   - stale timestamp (older than threshold for current session)
 *   - provider missing or quote shape malformed
 *   - provider disagreement ("mismatch")
 *   - impossible jump vs the last verified anchor for that ticker
 *
 * Output is a typed `QuoteValidation` that downstream code can branch on
 * without re-implementing the same checks. No UI redesign — the scanner
 * simply refuses to rank / select contracts when status is anything other
 * than `verified` or acceptable `cached`.
 */
import type { ConsensusQuote } from "./quote-types";

export type QuoteStatus =
  | "verified"      // fresh, in-range, agreement="verified"/"close"/"single"
  | "cached"        // last-good sticky value, still acceptable
  | "stale"         // present but timestamp too old for current session
  | "mismatch"      // providers disagree meaningfully
  | "suspicious"    // diverges from last verified anchor beyond threshold
  | "unavailable";  // missing / NaN / <=0 / malformed

export interface QuoteValidation {
  status: QuoteStatus;
  /** True ONLY for `verified`. Use this as the hard gate. */
  ok: boolean;
  /** True for `verified` OR acceptable `cached`. Use for soft fallback. */
  rankable: boolean;
  /** Resolved price (NaN if not usable). */
  price: number;
  /** Source identifier we trusted (or "none"). */
  source: string;
  /** Quote timestamp (ms epoch) or null. */
  ts: number | null;
  /** Age of the quote in ms (or null). */
  ageMs: number | null;
  /** 0–1 confidence score. */
  confidence: number;
  /** Why we landed on this status — short human string. */
  reason: string;
  /** Short user-facing label suitable for badges. */
  display: string;
}

interface ValidateOpts {
  /** Now in ms — injectable for tests. */
  now?: number;
  /** Max age before quote is considered "stale". Defaults adapt to session. */
  maxAgeMs?: number;
  /** Realistic price ceiling — anything above is rejected as garbage. */
  maxPrice?: number;
  /** Max % deviation from anchor before quote is flagged "suspicious". */
  maxAnchorDeviationPct?: number;
  /** Treat as cached (sticky last-good) rather than verified. */
  cached?: boolean;
  /** Current session — affects staleness thresholds. */
  session?: "open" | "pre" | "after" | "closed" | "weekend" | "unknown";
}

// ── Sanity anchors ────────────────────────────────────────────────────────
// Hand-curated coarse ranges for popular tickers. Used as a guardrail
// against catastrophic provider corruption (e.g. SPY at $5). Numbers are
// generous on purpose — we only reject obviously wrong quotes.
const HARD_RANGES: Record<string, [number, number]> = {
  SPY:  [200, 1200],
  QQQ:  [200, 1500],
  IWM:  [100, 600],
  DIA:  [200, 800],
  SMH:  [100, 800],
  XLK:  [80, 600],
  XLF:  [20, 200],
  VIX:  [5, 120],
  NVDA: [40, 5000],
  AMD:  [30, 2000],
  MSFT: [150, 2500],
  AAPL: [80, 1500],
  TSLA: [50, 3000],
  META: [80, 3000],
  GOOGL:[60, 1500],
  AMZN: [60, 1500],
  NFLX: [200, 5000],
  AVGO: [80, 5000],
};

function hardRangeOk(symbol: string, price: number): boolean {
  const r = HARD_RANGES[symbol.toUpperCase()];
  if (!r) return price > 0.01 && price < 1_000_000; // generic floor/ceiling
  return price >= r[0] && price <= r[1];
}

// ── Anchor store: last verified quote per ticker (in-memory, per session) ──
interface Anchor {
  price: number;
  ts: number;
  source: string;
}
const anchors = new Map<string, Anchor>();

export function getAnchor(symbol: string): Anchor | null {
  return anchors.get(symbol.toUpperCase()) ?? null;
}

export function setAnchor(symbol: string, a: Anchor): void {
  anchors.set(symbol.toUpperCase(), a);
}

export function clearAnchors(): void {
  anchors.clear();
}

// ── Staleness defaults by session ─────────────────────────────────────────
function defaultMaxAge(session: ValidateOpts["session"]): number {
  switch (session) {
    case "open":    return 5 * 60_000;       // 5 minutes during RTH
    case "pre":
    case "after":   return 15 * 60_000;      // 15 minutes extended hours
    case "closed":  return 12 * 60 * 60_000; // 12h overnight
    case "weekend": return 72 * 60 * 60_000; // weekend tolerance
    default:        return 10 * 60_000;
  }
}

// ── Core validator ────────────────────────────────────────────────────────

function unavailable(reason: string): QuoteValidation {
  return {
    status: "unavailable",
    ok: false,
    rankable: false,
    price: NaN,
    source: "none",
    ts: null,
    ageMs: null,
    confidence: 0,
    reason,
    display: "Quote unavailable",
  };
}

/**
 * Validate a consensus quote. Pass `cached: true` when this value comes
 * from a sticky last-good store rather than a fresh poll.
 */
export function validateQuote(
  symbol: string,
  q: ConsensusQuote | null | undefined,
  opts: ValidateOpts = {},
): QuoteValidation {
  const sym = (symbol || "").trim().toUpperCase();
  if (!sym) return unavailable("missing ticker");
  if (!q || typeof q !== "object") return unavailable("no quote");

  const price = Number(q.price);
  if (!Number.isFinite(price)) return unavailable("price not numeric");
  if (price <= 0) return unavailable("price <= 0");

  const maxPrice = opts.maxPrice ?? 1_000_000;
  if (price > maxPrice) return unavailable(`price > ${maxPrice}`);

  if (!hardRangeOk(sym, price)) {
    return {
      status: "suspicious",
      ok: false,
      rankable: false,
      price,
      source: q.consensusSource ?? "unknown",
      ts: typeof q.ts === "number" ? q.ts : null,
      ageMs: null,
      confidence: 0.1,
      reason: `price ${price} outside sanity range for ${sym}`,
      display: "Latest price not verified",
    };
  }

  const ts = typeof q.ts === "number" && Number.isFinite(q.ts) ? q.ts : null;
  if (ts === null) return unavailable("missing timestamp");

  const source = q.consensusSource;
  if (!source) return unavailable("missing provider");

  const now = opts.now ?? Date.now();
  const ageMs = Math.max(0, now - ts);
  const maxAge = opts.maxAgeMs ?? defaultMaxAge(opts.session);

  // Provider disagreement → mismatch.
  if (q.agreement === "mismatch") {
    return {
      status: "mismatch",
      ok: false,
      rankable: false,
      price,
      source,
      ts,
      ageMs,
      confidence: 0.3,
      reason: `providers disagree (Δ ${q.diffPct != null ? (q.diffPct * 100).toFixed(2) + "%" : "?"})`,
      display: "Quote mismatch",
    };
  }

  // Anchor sanity — reject implausible jumps vs last verified value.
  const anchor = getAnchor(sym);
  const maxDevPct = opts.maxAnchorDeviationPct ?? 0.25; // 25% guardrail
  if (anchor && anchor.price > 0) {
    const dev = Math.abs(price - anchor.price) / anchor.price;
    const anchorAgeMs = now - anchor.ts;
    // Only enforce when anchor is recent (< 24h) — otherwise drift is fine.
    if (anchorAgeMs < 24 * 60 * 60_000 && dev > maxDevPct) {
      return {
        status: "suspicious",
        ok: false,
        rankable: false,
        price,
        source,
        ts,
        ageMs,
        confidence: 0.2,
        reason: `Δ ${(dev * 100).toFixed(1)}% vs anchor $${anchor.price.toFixed(2)} (${Math.round(anchorAgeMs / 60_000)}m old)`,
        display: "Latest price not verified",
      };
    }
  }

  // Staleness — only flag if older than session threshold.
  if (ageMs > maxAge) {
    return {
      status: "stale",
      ok: false,
      rankable: opts.cached === true, // cached+stale is still soft-usable
      price,
      source,
      ts,
      ageMs,
      confidence: 0.4,
      reason: `${Math.round(ageMs / 60_000)}m old (max ${Math.round(maxAge / 60_000)}m)`,
      display: "Price needs refresh",
    };
  }

  // Cached but otherwise clean — soft-usable but not "verified".
  if (opts.cached === true) {
    return {
      status: "cached",
      ok: false,
      rankable: true,
      price,
      source,
      ts,
      ageMs,
      confidence: 0.7,
      reason: `cached last-good (${Math.round(ageMs / 1000)}s old)`,
      display: "Cached quote",
    };
  }

  // All checks passed — verified. Promote to anchor.
  setAnchor(sym, { price, ts, source });
  return {
    status: "verified",
    ok: true,
    rankable: true,
    price,
    source,
    ts,
    ageMs,
    confidence: q.agreement === "verified" ? 1.0 : q.agreement === "close" ? 0.9 : 0.8,
    reason: `verified via ${source}`,
    display: "Verified",
  };
}

/** Snapshot validator — confirms an underlying price is acceptable. */
export function quoteIsRankable(v: QuoteValidation | null | undefined): boolean {
  return !!v && v.rankable;
}
