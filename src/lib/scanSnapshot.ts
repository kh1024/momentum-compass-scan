/**
 * Persistent scan-snapshot cache (client-side, isomorphic-wrapped).
 *
 * Stale-while-revalidate for the scanner / dashboard pick tables:
 *  - On every successful enrichment, persist the full result + metadata.
 *  - On cold start, the matching snapshot seeds react-query so the table
 *    paints instantly from the last verified scan.
 *  - We REFUSE to overwrite a good snapshot with empty/broken data.
 *
 * Each public function is wrapped with `createIsomorphicFn` so the server
 * branch returns a safe no-op and the client branch performs localStorage
 * I/O. This lets the file be statically imported from anywhere (including
 * route files) without tripping TanStack's import-protection plugin.
 */
import { createIsomorphicFn } from "@tanstack/react-start";
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

interface OptionsChainShape {
  envelopes: Record<string, unknown>;
  raw: EnrichmentResult;
  live: boolean;
  rateLimited: boolean;
  retryInMs: number;
  retryAt: number | null;
  message: string | null;
}

export type OptionsSnapshot<T extends OptionsChainShape = OptionsChainShape> =
  BaseSnapshot<T>;

// ── Client-only helpers (only invoked from createIsomorphicFn.client()) ────

function logSnapshot(
  level: "info" | "warn",
  key: string,
  reason: string,
  extra?: unknown,
) {
  const debugOn =
    window.localStorage.getItem("debug:snapshots") === "1" ||
    import.meta.env?.DEV;
  if (!debugOn) return;
  const tag = `[snapshot:${key}]`;
  if (level === "warn") console.warn(tag, reason, extra ?? "");
  else console.info(tag, reason, extra ?? "");
}

function purge(key: string, reason: string) {
  try {
    window.localStorage.removeItem(key);
    logSnapshot("warn", key, `purged: ${reason}`);
  } catch {
    /* ignore */
  }
}

type ValidationResult = { ok: true } | { ok: false; reason: string };

function validateEnrichment(r: unknown): ValidationResult {
  if (!r || typeof r !== "object")
    return { ok: false, reason: "result not an object" };
  const er = r as Partial<EnrichmentResult>;
  if (er.rateLimited) return { ok: false, reason: "rate-limited payload" };
  const enriched = (er.enriched ?? {}) as Record<
    string,
    { contract?: unknown } | undefined
  >;
  if (typeof enriched !== "object" || enriched === null)
    return { ok: false, reason: "missing enriched map" };
  let hasContract = false;
  for (const v of Object.values(enriched)) {
    if (v && typeof v === "object" && "contract" in v && v.contract) {
      hasContract = true;
      break;
    }
  }
  if (!hasContract)
    return { ok: false, reason: "no enriched contracts in payload" };
  return { ok: true };
}

function validateOptions(r: unknown): ValidationResult {
  if (!r || typeof r !== "object")
    return { ok: false, reason: "options result not an object" };
  const o = r as Partial<OptionsChainShape>;
  if (o.rateLimited)
    return { ok: false, reason: "rate-limited options payload" };
  return validateEnrichment(o.raw);
}

function loadAtClient<T>(
  key: string,
  pickKey: string,
  validate: (r: unknown) => ValidationResult,
): BaseSnapshot<T> | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
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
  if (
    typeof parsed.savedAt !== "number" ||
    !Number.isFinite(parsed.savedAt)
  ) {
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

function saveAtClient<T>(
  key: string,
  pickKey: string,
  result: T,
  validate: (r: unknown) => ValidationResult,
  marketSession?: string,
): boolean {
  const check = validate(result);
  if (!check.ok) {
    logSnapshot("info", key, `refused to save: ${check.reason}`);
    return false;
  }
  try {
    const snap: BaseSnapshot<T> = {
      pickKey,
      result,
      savedAt: Date.now(),
      marketSession,
    };
    window.localStorage.setItem(key, JSON.stringify(snap));
    return true;
  } catch (e) {
    logSnapshot("warn", key, "localStorage write failed", e);
    return false;
  }
}

// ── Public API (isomorphic-wrapped) ────────────────────────────────────────

export const loadScanSnapshot = createIsomorphicFn()
  .server((_pickKey: string): ScanSnapshot | null => null)
  .client((pickKey: string): ScanSnapshot | null =>
    loadAtClient<EnrichmentResult>(DASHBOARD_KEY, pickKey, validateEnrichment),
  );

export const saveScanSnapshot = createIsomorphicFn()
  .server(
    (_pickKey: string, _result: EnrichmentResult, _marketSession?: string) =>
      false,
  )
  .client(
    (pickKey: string, result: EnrichmentResult, marketSession?: string) =>
      saveAtClient<EnrichmentResult>(
        DASHBOARD_KEY,
        pickKey,
        result,
        validateEnrichment,
        marketSession,
      ),
  );

export const loadOptionsSnapshot = createIsomorphicFn()
  .server((_pickKey: string): OptionsSnapshot | null => null)
  .client(
    (pickKey: string): OptionsSnapshot | null =>
      loadAtClient<OptionsChainShape>(OPTIONS_KEY, pickKey, validateOptions),
  );

export const saveOptionsSnapshot = createIsomorphicFn()
  .server(
    (
      _pickKey: string,
      _result: OptionsChainShape,
      _marketSession?: string,
    ) => false,
  )
  .client(
    (
      pickKey: string,
      result: OptionsChainShape,
      marketSession?: string,
    ) =>
      saveAtClient<OptionsChainShape>(
        OPTIONS_KEY,
        pickKey,
        result,
        validateOptions,
        marketSession,
      ),
  );

export const getSnapshotAge = createIsomorphicFn()
  .server((): number | null => null)
  .client((): number | null => {
    try {
      const raw = window.localStorage.getItem(DASHBOARD_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as BaseSnapshot<unknown>;
      if (!parsed?.savedAt) return null;
      return Date.now() - parsed.savedAt;
    } catch {
      return null;
    }
  });
