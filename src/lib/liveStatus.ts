/**
 * Shared "live state" derivation — single source of truth for the LIVE badge,
 * RefreshBar copy, and unavailable explanations. Replaces the ad-hoc
 * "anyLive ?? sticky" logic that produced LIVE while quotes were never set.
 */

export type LiveState =
  | "live"        // fresh data, ≤ LIVE_MS old
  | "delayed"     // data exists but ≤ DELAYED_MS old
  | "stale"       // data exists but older than DELAYED_MS
  | "refreshing"  // fetch in-flight with existing (possibly stale) data
  | "connecting"  // first fetch in-flight, no data yet
  | "rate-limited"
  | "unavailable" // no data, no fetch happening
  | "error";

export const LIVE_MS = 90_000;          // ≤ 90s → live
export const DELAYED_MS = 5 * 60_000;   // ≤ 5m → delayed

export interface DeriveLiveStateInput {
  /** Timestamp of the freshest successful fetch, ms. null if never. */
  updatedAt: number | null;
  /** A query is currently in-flight. */
  isFetching?: boolean;
  /** Provider has rate-limited recent requests. */
  rateLimited?: boolean;
  /** Last fetch errored. */
  hasError?: boolean;
  now?: number;
}

export function deriveLiveState({
  updatedAt,
  isFetching = false,
  rateLimited = false,
  hasError = false,
  now = Date.now(),
}: DeriveLiveStateInput): LiveState {
  if (rateLimited) return "rate-limited";
  if (updatedAt == null) {
    if (isFetching) return "connecting";
    if (hasError) return "error";
    return "unavailable";
  }
  const age = Math.max(0, now - updatedAt);
  if (age <= LIVE_MS) return "live";
  if (isFetching) return "refreshing";
  if (age <= DELAYED_MS) return "delayed";
  return "stale";
}

/** Compact label for badges. */
export const LIVE_STATE_LABEL: Record<LiveState, string> = {
  live: "Live",
  delayed: "Delayed",
  stale: "Stale",
  refreshing: "Refreshing",
  connecting: "Connecting",
  "rate-limited": "Rate Limited",
  unavailable: "Offline",
  error: "Error",
};

/** Longer human-readable explanation for empty/unavailable states. */
export const LIVE_STATE_EXPLAIN: Record<LiveState, string> = {
  live: "Receiving live quotes",
  delayed: "Quotes delayed — provider may be throttling",
  stale: "Last successful refresh is more than 5 minutes old",
  refreshing: "Refreshing market data…",
  connecting: "Connecting to market data provider…",
  "rate-limited": "Rate limited by provider — retrying shortly",
  unavailable: "Waiting for live quote provider",
  error: "Quote provider unreachable — reconnecting",
};

export function liveStateTone(s: LiveState): "bull" | "warn" | "neutral" | "bear" {
  if (s === "live") return "bull";
  if (s === "delayed" || s === "refreshing" || s === "connecting" || s === "rate-limited") return "warn";
  if (s === "error") return "bear";
  return "neutral";
}

/** Format ms as "Xs / Xm / Xh ago". */
export function formatAgo(ts: number | null, now: number = Date.now()): string {
  if (!ts) return "—";
  const ms = Math.max(0, now - ts);
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}
