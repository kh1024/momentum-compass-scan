/**
 * US equity market hours helper.
 * Regular session: Mon–Fri, 09:30–16:00 America/New_York.
 * Premarket:        04:00–09:30
 * After hours:      16:00–20:00
 * (Holidays are not modeled — close enough for scan cadence.)
 */

export type MarketSession =
  | "open"        // regular session
  | "premarket"   // 04:00–09:30 ET, weekday
  | "afterhours"  // 16:00–20:00 ET, weekday
  | "closed"      // weekday outside any session
  | "weekend";    // Sat / Sun

interface NyParts { weekday: string; minutes: number; }

function nyParts(now: Date = new Date()): NyParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hh = parseInt(get("hour"), 10) || 0;
  const mm = parseInt(get("minute"), 10) || 0;
  return { weekday: get("weekday"), minutes: hh * 60 + mm };
}

export function getMarketSession(now: Date = new Date()): MarketSession {
  const { weekday, minutes } = nyParts(now);
  if (weekday === "Sat" || weekday === "Sun") return "weekend";
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "open";
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "premarket";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "afterhours";
  return "closed";
}

export function isMarketOpen(now: Date = new Date()): boolean {
  return getMarketSession(now) === "open";
}

/** Human-readable label for the current session. */
export function marketSessionLabel(s: MarketSession = getMarketSession()): string {
  switch (s) {
    case "open":       return "Market Open";
    case "premarket":  return "Premarket";
    case "afterhours": return "After Hours";
    case "closed":     return "Market Closed";
    case "weekend":    return "Weekend";
  }
}

/** Scan cadence: 30 min during market, once per day off-hours. */
export const SCAN_INTERVAL_OPEN_MS = 30 * 60_000;
export const SCAN_INTERVAL_CLOSED_MS = 24 * 60 * 60_000;

export function scanIntervalMs(now: Date = new Date()): number {
  return isMarketOpen(now) ? SCAN_INTERVAL_OPEN_MS : SCAN_INTERVAL_CLOSED_MS;
}

/**
 * Adaptive refresh cadence for live data hooks.
 * Goal: fast & fresh during the regular session, calm and bandwidth-friendly
 * outside of it, fully paused on weekends (last verified data is preserved).
 */
export interface AdaptiveIntervals {
  quotes: number | false;   // live quote refresh
  chain: number | false;    // option chain refresh
  sentiment: number | false; // reddit / sentiment refresh
  earnings: number;          // earnings refresh (always slow)
  scan: number;              // full scanner refresh
}

export function getAdaptiveIntervals(now: Date = new Date()): AdaptiveIntervals {
  const s = getMarketSession(now);
  switch (s) {
    case "open":
      return { quotes: 30_000, chain: 90_000, sentiment: 15 * 60_000, earnings: 60 * 60_000, scan: SCAN_INTERVAL_OPEN_MS };
    case "premarket":
    case "afterhours":
      return { quotes: 2 * 60_000, chain: 5 * 60_000, sentiment: 30 * 60_000, earnings: 60 * 60_000, scan: 2 * 60 * 60_000 };
    case "closed":
      return { quotes: 10 * 60_000, chain: 15 * 60_000, sentiment: 60 * 60_000, earnings: 6 * 60 * 60_000, scan: 6 * 60 * 60_000 };
    case "weekend":
    default:
      return { quotes: false, chain: false, sentiment: false, earnings: 24 * 60 * 60_000, scan: 24 * 60 * 60_000 };
  }
}

