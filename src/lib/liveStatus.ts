/**
 * Shared "live state" derivation — single source of truth for the LIVE badge,
 * RefreshBar copy, and unavailable explanations.
 *
 * Thresholds are market-session aware: a 10-minute-old quote is "stale" at
 * 10:00am ET but completely fine at 10:00pm or on a Saturday. The product is a
 * next-day / swing scanner, not a tick-by-tick terminal, so off-hours data is
 * presented as "Showing latest verified scan" instead of an alarm.
 */

import { getMarketSession, type MarketSession } from "@/lib/marketHours";

export type LiveState =
  | "live"          // fresh data
  | "recent"        // recently updated, slightly past "live" window
  | "delayed"       // older than recent but still acceptable for the session
  | "stale"         // genuinely old for the current session
  | "refreshing"    // fetch in-flight with existing data
  | "connecting"    // first fetch in-flight, no data yet
  | "rate-limited"
  | "market-closed" // off-hours, latest verified scan being shown
  | "awaiting"      // off-hours, no scan yet; waiting for next session
  | "unavailable"   // provider disconnected / no data
  | "error";

// Per-session thresholds (ms). Tuple = [live, recent, delayed]; older than
// `delayed` is considered stale for that session.
const QUOTE_THRESHOLDS: Record<MarketSession, [number, number, number]> = {
  open:       [2 * 60_000,   5 * 60_000,  15 * 60_000],
  premarket:  [5 * 60_000,  15 * 60_000,  30 * 60_000],
  afterhours: [5 * 60_000,  15 * 60_000,  30 * 60_000],
  closed:     [30 * 60_000, 60 * 60_000, 6 * 60 * 60_000],
  weekend:    [60 * 60_000, 6 * 60 * 60_000, 48 * 60 * 60_000],
};

// Slightly more lenient for option chains — option scans are scheduled bursts.
const CHAIN_THRESHOLDS: Record<MarketSession, [number, number, number]> = {
  open:       [5 * 60_000,  10 * 60_000, 30 * 60_000],
  premarket:  [15 * 60_000, 30 * 60_000, 60 * 60_000],
  afterhours: [15 * 60_000, 30 * 60_000, 60 * 60_000],
  closed:     [60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000],
  weekend:    [6 * 60 * 60_000, 24 * 60 * 60_000, 72 * 60 * 60_000],
};

// Backwards-compatible exports (some callers still import these constants).
export const LIVE_MS = QUOTE_THRESHOLDS.open[0];
export const DELAYED_MS = QUOTE_THRESHOLDS.open[2];

export interface DeriveLiveStateInput {
  /** Timestamp of the freshest successful fetch, ms. null if never. */
  updatedAt: number | null;
  /** A query is currently in-flight. */
  isFetching?: boolean;
  /** Provider has rate-limited recent requests. */
  rateLimited?: boolean;
  /** Last fetch errored. */
  hasError?: boolean;
  /** Treat input as option-chain data (more lenient thresholds). */
  kind?: "quote" | "chain";
  /** Override the current market session (default: derived from now()). */
  session?: MarketSession;
  now?: number;
}

export function deriveLiveState({
  updatedAt,
  isFetching = false,
  rateLimited = false,
  hasError = false,
  kind = "quote",
  session,
  now = Date.now(),
}: DeriveLiveStateInput): LiveState {
  const sess = session ?? getMarketSession(new Date(now));
  const offHours = sess !== "open";

  if (rateLimited) return "rate-limited";

  if (updatedAt == null) {
    if (isFetching) return "connecting";
    if (hasError) return offHours ? "awaiting" : "error";
    return offHours ? "awaiting" : "unavailable";
  }

  const thresholds = kind === "chain" ? CHAIN_THRESHOLDS[sess] : QUOTE_THRESHOLDS[sess];
  const age = Math.max(0, now - updatedAt);
  const [liveMs, recentMs, delayedMs] = thresholds;

  // Off-hours short-circuit: if the market is closed, an old timestamp is
  // expected and normal — present it as "market-closed", not "refreshing"
  // or "stale". A background refetch shouldn't flip the badge either.
  if (offHours && age > recentMs) return "market-closed";

  if (age <= liveMs) return "live";
  if (isFetching) return "refreshing";
  if (age <= recentMs) return "recent";
  if (age <= delayedMs) return "delayed";

  // Genuinely past the delayed window during market hours — needs attention.
  return "stale";
}

/** Compact label for badges. */
export const LIVE_STATE_LABEL: Record<LiveState, string> = {
  live: "Live",
  recent: "Recent",
  delayed: "Delayed",
  stale: "Delayed",
  refreshing: "Refreshing",
  connecting: "Connecting",
  "rate-limited": "Rate Limited",
  "market-closed": "Market Closed",
  awaiting: "Awaiting Refresh",
  unavailable: "Offline",
  error: "Reconnecting",
};

/** Longer human-readable explanation. Calm, professional, never alarmist. */
export const LIVE_STATE_EXPLAIN: Record<LiveState, string> = {
  live: "Live market data",
  recent: "Recently updated",
  delayed: "Quotes lightly delayed",
  stale: "Awaiting next refresh",
  refreshing: "Refreshing market data…",
  connecting: "Connecting to market data…",
  "rate-limited": "Provider rate-limited — retrying shortly",
  "market-closed": "Market closed — latest verified scan displayed",
  awaiting: "Awaiting next scheduled refresh",
  unavailable: "Live quotes paused — provider unavailable",
  error: "Reconnecting to quote provider",
};

export function liveStateTone(s: LiveState): "bull" | "warn" | "neutral" | "bear" {
  if (s === "live") return "bull";
  if (s === "recent" || s === "refreshing" || s === "connecting") return "neutral";
  if (s === "delayed" || s === "rate-limited" || s === "awaiting") return "warn";
  if (s === "market-closed") return "neutral";
  if (s === "stale" || s === "error" || s === "unavailable") return "bear";
  return "neutral";
}

/** Is this state worth showing the user a banner about? */
export function isAlarmingState(s: LiveState): boolean {
  return s === "stale" || s === "error" || s === "unavailable";
}

/** Format ms as "Xs / Xm / Xh ago". */
export function formatAgo(ts: number | null, now: number = Date.now()): string {
  if (!ts) return "—";
  const ms = Math.max(0, now - ts);
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 3_600_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / (24 * 3_600_000))}d ago`;
}
