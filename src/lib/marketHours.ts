/**
 * US equity market hours helper.
 * Regular session: Mon–Fri, 09:30–16:00 America/New_York.
 * (Holidays are not modeled — close enough for scan cadence.)
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  // Convert to NY time using Intl
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday"); // Mon, Tue, ...
  if (wd === "Sat" || wd === "Sun") return false;
  const hh = parseInt(get("hour"), 10);
  const mm = parseInt(get("minute"), 10);
  const minutes = hh * 60 + mm;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/** Scan cadence: 30 min during market, once per day off-hours. */
export const SCAN_INTERVAL_OPEN_MS = 30 * 60_000;
export const SCAN_INTERVAL_CLOSED_MS = 24 * 60 * 60_000;

export function scanIntervalMs(now: Date = new Date()): number {
  return isMarketOpen(now) ? SCAN_INTERVAL_OPEN_MS : SCAN_INTERVAL_CLOSED_MS;
}
