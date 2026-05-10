/**
 * Deterministic option-expiration helpers.
 *
 * Two goals:
 *  1. Produce realistic monthly-expiration Fridays (3rd Friday of a month) so
 *     mocked contracts don't show random weekdays.
 *  2. Be SSR-safe: anchor to start-of-UTC-day so server render and the first
 *     client render produce identical strings (no React hydration mismatch).
 */

function startOfUtcDayMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** 3rd Friday of the given UTC year/month, returned as YYYY-MM-DD. */
function thirdFridayOf(year: number, month: number): string {
  // month is 0-indexed
  const first = new Date(Date.UTC(year, month, 1));
  const dow = first.getUTCDay(); // 0 Sun..6 Sat; Friday = 5
  const offset = (5 - dow + 7) % 7; // days until first Friday
  const day = 1 + offset + 14; // third Friday
  const y = year.toString().padStart(4, "0");
  const m = (month + 1).toString().padStart(2, "0");
  const d = day.toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function thirdFridayMs(year: number, month: number): number {
  const iso = thirdFridayOf(year, month);
  return Date.parse(`${iso}T00:00:00Z`);
}

/**
 * Pick the monthly-expiration Friday closest to `dteHint` days from the start
 * of today (UTC). Always returns a date >= today.
 */
export function monthlyExpirationFromDte(dteHint: number): string {
  const today = startOfUtcDayMs();
  const targetMs = today + Math.max(1, dteHint) * 86_400_000;
  const target = new Date(targetMs);
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth();

  // Candidate months: target month, prev, next — pick whichever 3rd Friday
  // is >= today and minimizes distance to targetMs.
  const candidates: Array<{ iso: string; ms: number }> = [];
  for (const dm of [-1, 0, 1, 2]) {
    const yy = y + Math.floor((m + dm) / 12);
    const mm = ((m + dm) % 12 + 12) % 12;
    const ms = thirdFridayMs(yy, mm);
    if (ms >= today) candidates.push({ iso: thirdFridayOf(yy, mm), ms });
  }
  if (candidates.length === 0) {
    // Shouldn't happen, but fall back to next month's 3rd Friday.
    return thirdFridayOf(y, m + 1);
  }
  candidates.sort((a, b) => Math.abs(a.ms - targetMs) - Math.abs(b.ms - targetMs));
  return candidates[0].iso;
}

/**
 * Find the nearest upcoming Friday to `dteHint` days from today.
 * Unlike `monthlyExpirationFromDte` this considers ALL Fridays (weekly
 * expirations), so the actual DTE stays very close to the hint.
 */
export function weeklyExpirationFromDte(dteHint: number): string {
  const today = startOfUtcDayMs();
  const targetMs = today + Math.max(1, dteHint) * 86_400_000;
  const maxDays = Math.max(Math.ceil(dteHint * 2.5), 90);

  let bestIso = "";
  let bestDist = Infinity;

  for (let d = 1; d <= maxDays; d++) {
    const ms = today + d * 86_400_000;
    const date = new Date(ms);
    if (date.getUTCDay() === 5) { // Friday
      const dist = Math.abs(ms - targetMs);
      if (dist < bestDist) {
        bestDist = dist;
        const y = date.getUTCFullYear().toString();
        const mo = (date.getUTCMonth() + 1).toString().padStart(2, "0");
        const dy = date.getUTCDate().toString().padStart(2, "0");
        bestIso = `${y}-${mo}-${dy}`;
      }
    }
  }

  return bestIso || monthlyExpirationFromDte(dteHint);
}

/** Days between today (UTC) and the given YYYY-MM-DD expiration. */
export function dteFromExpiration(expiration: string): number {
  const expMs = Date.parse(`${expiration}T00:00:00Z`);
  if (!isFinite(expMs)) return 0;
  const today = startOfUtcDayMs();
  return Math.max(0, Math.round((expMs - today) / 86_400_000));
}
