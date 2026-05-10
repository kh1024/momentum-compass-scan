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

/** Dev-mode logger. Production builds stay silent unless DEBUG flag is set. */
function logSnapshot(level: "info" | "warn", key: string, reason: string, extra?: unknown) {
  const w = safeWindow();
  const debugOn =
    !!w && (w.localStorage.getItem("debug:snapshots") === "1" || import.meta.env?.DEV);
  if (!debugOn) return;
  const tag = `[snapshot:${key}]`;
  if (level === "warn") console.warn(tag, reason, extra ?? "");
  else console.info(tag, reason, extra ?? "");
}

/** Purge a corrupt entry so it can't be re-evaluated on every paint. */
function purge(key: string, reason: string) {
  const w = safeWindow();
  if (!w) return;
  try {
    w.localStorage.removeItem(key);
    logSnapshot("warn", key, `purged: ${reason}`);
  } catch {
    /* ignore */
  }
}

/** Structural validation result with a human-readable reason. */
type ValidationResult = { ok: true } | { ok: false; reason: string };

function validateEnrichment(r: unknown): ValidationResult {
  if (!r || typeof r !== "object") return { ok: false, reason: "result not an object" };
  const er = r as Partial<EnrichmentResult>;
  if (er.rateLimited) return { ok: false, reason: "rate-limited payload" };
  const enriched = (er.enriched ?? {}) as Record<string, { contract?: unknown } | undefined>;
  if (typeof enriched !== "object" || enriched === null)
    return { ok: false, reason: "missing enriched map" };
  let hasContract = false;
  for (const v of Object.values(enriched)) {
    if (v && typeof v === "object" && "contract" in v && v.contract) {
      hasContract = true;
      break;
    }
  }
  if (!hasContract) return { ok: false, reason: "no enriched contracts in payload" };
  return { ok: true };
}

function isVerifiedEnrichment(r: EnrichmentResult | null | undefined): r is EnrichmentResult {
  return validateEnrichment(r).ok;
}

/**
 * Generic loader/saver. Validation predicate guards against overwriting good
 * data with broken refreshes — callers can pass their own shape check.
 */
function loadAt<T>(
  key: string,
  pickKey: string,
  validate: (r: unknown) => ValidationResult,
): BaseSnapshot<T> | null {
  const w = safeWindow();
  if (!w) return null;
  let raw: string | null = null;
  try {
    raw = w.localStorage.getItem(key);
  } catch (e) {
    logSnapshot("warn", key, "localStorage read failed", e);
    return null;
  }
  if (!raw) return null;

  let parsed: BaseSnapshot<T> | null = null;
  try {
    parsed = JSON.parse(raw) as BaseSnapshot<T>;
  } catch (e) {
    purge(key, "JSON parse failed");
    logSnapshot("warn", key, "JSON parse failed", e);
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    purge(key, "envelope not an object");
    return null;
  }
  if (typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) {
    purge(key, "missing/invalid savedAt");
    return null;
  }
  if (typeof parsed.pickKey !== "string") {
    purge(key, "missing pickKey");
    return null;
  }
  const age = Date.now() - parsed.savedAt;
  if (age > MAX_AGE_MS) {
    purge(key, `expired (${Math.round(age / 3_600_000)}h old)`);
    return null;
  }
  if (parsed.pickKey !== pickKey) {
    // Normal case: user reordered picks. Don't purge — another mount may match.
    logSnapshot("info", key, "pickKey mismatch (cache miss, kept)");
    return null;
  }
  const check = validate(parsed.result);
  if (!check.ok) {
    purge(key, `invalid result: ${check.reason}`);
    return null;
  }
  logSnapshot("info", key, `hydrated (age ${Math.round(age / 1000)}s)`);
  return parsed;
}

function saveAt<T>(
  key: string,
  pickKey: string,
  result: T,
  validate: (r: unknown) => ValidationResult,
  marketSession?: string,
): boolean {
  const w = safeWindow();
  if (!w) return false;
  const check = validate(result);
  if (!check.ok) {
    logSnapshot("info", key, `refused to save: ${check.reason}`);
    return false;
  }
  try {
    const snap: BaseSnapshot<T> = { pickKey, result, savedAt: Date.now(), marketSession };
    w.localStorage.setItem(key, JSON.stringify(snap));
    return true;
  } catch (e) {
    logSnapshot("warn", key, "localStorage write failed", e);
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
