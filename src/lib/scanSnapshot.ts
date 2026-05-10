/**
 * Persistent scan-snapshot cache (client-side).
 *
 * Stale-while-revalidate for the scanner / dashboard pick tables:
 *  - On every successful enrichment, persist the full result + metadata.
 *  - On cold start, the matching snapshot seeds react-query so the table
 *    paints instantly from the last verified scan.
 *  - We REFUSE to overwrite a good snapshot with empty/broken data — a
 *    refresh that returns zero enriched contracts leaves the previous
 *    verified snapshot untouched.
 *
 * Two variants are persisted under separate keys:
 *   - dashboard chain (EnrichmentResult shape) — `scanner:dashboardSnapshot:v1`
 *   - scanner options chain (OptionsChainResult shape) — `scanner:optionsSnapshot:v1`
 */
import type { EnrichmentResult } from "@/lib/chain.functions";

const DASHBOARD_KEY = "scanner:dashboardSnapshot:v1";
const OPTIONS_KEY = "scanner:optionsSnapshot:v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface BaseSnapshot<T> {
  pickKey: string;
  result: T;
  savedAt: number;
  marketSession?: string;
}

export type ScanSnapshot = BaseSnapshot<EnrichmentResult>;

function safeWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

function isVerifiedEnrichment(r: EnrichmentResult | null | undefined): r is EnrichmentResult {
  if (!r || typeof r !== "object") return false;
  if (r.rateLimited) return false;
  const enriched = r.enriched ?? {};
  for (const v of Object.values(enriched)) {
    if (v && v.contract) return true;
  }
  return false;
}

/**
 * Generic loader/saver. Validation predicate guards against overwriting good
 * data with broken refreshes — callers can pass their own shape check.
 */
function loadAt<T>(key: string, pickKey: string, isValid: (r: T) => boolean): BaseSnapshot<T> | null {
  const w = safeWindow();
  if (!w) return null;
  try {
    const raw = w.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BaseSnapshot<T>;
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    if (parsed.pickKey !== pickKey) return null;
    if (!isValid(parsed.result)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveAt<T>(
  key: string,
  pickKey: string,
  result: T,
  isValid: (r: T) => boolean,
  marketSession?: string,
): boolean {
  const w = safeWindow();
  if (!w) return false;
  if (!isValid(result)) return false;
  try {
    const snap: BaseSnapshot<T> = { pickKey, result, savedAt: Date.now(), marketSession };
    w.localStorage.setItem(key, JSON.stringify(snap));
    return true;
  } catch {
    return false;
  }
}

// ── Dashboard (EnrichmentResult) ────────────────────────────────────────────
export const loadScanSnapshot = (pickKey: string): ScanSnapshot | null =>
  loadAt<EnrichmentResult>(DASHBOARD_KEY, pickKey, isVerifiedEnrichment);
export const saveScanSnapshot = (pickKey: string, result: EnrichmentResult, marketSession?: string): boolean =>
  saveAt<EnrichmentResult>(DASHBOARD_KEY, pickKey, result, isVerifiedEnrichment, marketSession);

// ── Scanner (OptionsChainResult-like) ────────────────────────────────────────
// We don't import the type here to avoid coupling — the validator only checks
// the `raw.enriched` shape, which is what `useOptionsChain` consumes.
interface OptionsChainShape {
  envelopes: Record<string, unknown>;
  raw: EnrichmentResult;
  live: boolean;
  rateLimited: boolean;
  retryInMs: number;
  retryAt: number | null;
  message: string | null;
}

function isVerifiedOptions(r: OptionsChainShape | null | undefined): r is OptionsChainShape {
  if (!r || typeof r !== "object") return false;
  if (r.rateLimited) return false;
  return isVerifiedEnrichment(r.raw);
}

export const loadOptionsSnapshot = <T extends OptionsChainShape>(pickKey: string): BaseSnapshot<T> | null =>
  loadAt<T>(OPTIONS_KEY, pickKey, (r) => isVerifiedOptions(r as OptionsChainShape));
export const saveOptionsSnapshot = <T extends OptionsChainShape>(pickKey: string, result: T, marketSession?: string): boolean =>
  saveAt<T>(OPTIONS_KEY, pickKey, result, (r) => isVerifiedOptions(r as OptionsChainShape), marketSession);

export function getSnapshotAge(): number | null {
  const w = safeWindow();
  if (!w) return null;
  try {
    const raw = w.localStorage.getItem(DASHBOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BaseSnapshot<unknown>;
    if (!parsed?.savedAt) return null;
    return Date.now() - parsed.savedAt;
  } catch {
    return null;
  }
}
