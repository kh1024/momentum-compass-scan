/**
 * Persistent scan-snapshot cache (client-side).
 *
 * Stale-while-revalidate for the scanner / dashboard pick table:
 *  - On every successful enrichment, persist the full `EnrichmentResult`
 *    plus metadata (savedAt, marketSession, pickKey).
 *  - On cold start, the matching snapshot seeds react-query so the table
 *    paints instantly from the last verified scan.
 *  - We REFUSE to overwrite a good snapshot with empty/broken data — a
 *    refresh that returns zero enriched contracts leaves the previous
 *    verified snapshot untouched.
 */
import type { EnrichmentResult } from "@/lib/chain.functions";

const KEY = "scanner:lastVerifiedSnapshot:v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ScanSnapshot {
  /** Stable cache-key for the pick set the snapshot was produced from. */
  pickKey: string;
  /** Full enrichment payload — fed back to react-query as initialData. */
  result: EnrichmentResult;
  /** When this snapshot was persisted (ms epoch). */
  savedAt: number;
  /** Market session label at scan time, for informational tooltips. */
  marketSession?: string;
}

function safeWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

/**
 * A snapshot is "verified" only when it has at least one successfully
 * enriched contract AND was not flagged as a rate-limited fallback.
 */
function isVerified(result: EnrichmentResult): boolean {
  if (!result || typeof result !== "object") return false;
  if (result.rateLimited) return false;
  const enriched = result.enriched ?? {};
  for (const v of Object.values(enriched)) {
    if (v && v.contract) return true;
  }
  return false;
}

export function loadScanSnapshot(pickKey: string): ScanSnapshot | null {
  const w = safeWindow();
  if (!w) return null;
  try {
    const raw = w.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScanSnapshot;
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    if (parsed.pickKey !== pickKey) return null;
    if (!isVerified(parsed.result)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist a snapshot only if it passes validation. Returns true when written.
 * NEVER overwrites a good snapshot with empty/broken data.
 */
export function saveScanSnapshot(
  pickKey: string,
  result: EnrichmentResult,
  marketSession?: string,
): boolean {
  const w = safeWindow();
  if (!w) return false;
  if (!isVerified(result)) return false;
  try {
    const snap: ScanSnapshot = {
      pickKey,
      result,
      savedAt: Date.now(),
      marketSession,
    };
    w.localStorage.setItem(KEY, JSON.stringify(snap));
    return true;
  } catch {
    return false;
  }
}

export function getSnapshotAge(): number | null {
  const w = safeWindow();
  if (!w) return null;
  try {
    const raw = w.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScanSnapshot;
    if (!parsed?.savedAt) return null;
    return Date.now() - parsed.savedAt;
  } catch {
    return null;
  }
}
