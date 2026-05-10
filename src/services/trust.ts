/**
 * Trust layer — every value the UI renders flows through a TrustEnvelope so
 * the UI can show provenance, freshness, and validation state instead of
 * silently rendering a fake or stale number.
 *
 * Status semantics (all wall-clock against `fetchedAt`):
 *   live        — fetched < LIVE_MS ago, validated, no provider error
 *   delayed     — fetched < DELAYED_MS ago, validated
 *   stale       — fetched ≥ DELAYED_MS ago but still has a value
 *   unavailable — never fetched / value missing / failed validation
 *   error       — provider or transport error
 */

export type DataStatus = "live" | "delayed" | "stale" | "unavailable" | "error";

export type DataSource =
  | "yahoo"
  | "stooq"
  | "finnhub"
  | "public-chain"
  | "reddit"
  | "earnings"
  | "cache"
  | "computed"
  | null;

export interface DataError {
  code: string;
  message: string;
}

export interface TrustEnvelope<T> {
  value: T | null;
  source: DataSource;
  fetchedAt: number | null;
  ageMs: number | null;
  status: DataStatus;
  error?: DataError;
  validated: boolean;
}

/** Freshness thresholds. Tunable per service if needed. */
export const TRUST_THRESHOLDS = {
  LIVE_MS: 60_000,        // ≤ 60s → live
  DELAYED_MS: 5 * 60_000, // ≤ 5m  → delayed, > 5m → stale
} as const;

export function ageOf(fetchedAt: number | null, now: number = Date.now()): number | null {
  return fetchedAt == null ? null : Math.max(0, now - fetchedAt);
}

export function statusFromAge(
  ageMs: number | null,
  validated: boolean,
  hasValue: boolean,
): DataStatus {
  if (!hasValue) return "unavailable";
  if (!validated) return "unavailable";
  if (ageMs == null) return "unavailable";
  if (ageMs <= TRUST_THRESHOLDS.LIVE_MS) return "live";
  if (ageMs <= TRUST_THRESHOLDS.DELAYED_MS) return "delayed";
  return "stale";
}

export function wrap<T>(args: {
  value: T | null;
  source: DataSource;
  fetchedAt?: number | null;
  validated?: boolean;
  error?: DataError;
  now?: number;
}): TrustEnvelope<T> {
  const fetchedAt = args.fetchedAt ?? (args.value != null ? (args.now ?? Date.now()) : null);
  const ageMs = ageOf(fetchedAt, args.now ?? Date.now());
  const validated = args.validated ?? args.value != null;
  const hasValue = args.value != null;
  const status: DataStatus = args.error
    ? "error"
    : statusFromAge(ageMs, validated, hasValue);
  return {
    value: args.value,
    source: args.source,
    fetchedAt,
    ageMs,
    status,
    error: args.error,
    validated,
  };
}

export function unavailable<T>(code: string, message?: string): TrustEnvelope<T> {
  return {
    value: null,
    source: null,
    fetchedAt: null,
    ageMs: null,
    status: "unavailable",
    error: { code, message: message ?? code },
    validated: false,
  };
}

export function errored<T>(code: string, message: string, source: DataSource = null): TrustEnvelope<T> {
  return {
    value: null,
    source,
    fetchedAt: null,
    ageMs: null,
    status: "error",
    error: { code, message },
    validated: false,
  };
}

/** Aggregate the worst status across many envelopes (for top-of-page rollups). */
export function rollupStatus(envelopes: Array<TrustEnvelope<unknown>>): DataStatus {
  if (envelopes.length === 0) return "unavailable";
  const order: DataStatus[] = ["live", "delayed", "stale", "unavailable", "error"];
  let worst: DataStatus = "live";
  for (const e of envelopes) {
    if (order.indexOf(e.status) > order.indexOf(worst)) worst = e.status;
  }
  return worst;
}

/** True when the envelope is usable for AI pick generation (gate input). */
export function isUsable<T>(e: TrustEnvelope<T>): boolean {
  return e.value != null && e.validated && (e.status === "live" || e.status === "delayed");
}

/** Human label for the badge component. */
export const STATUS_LABEL: Record<DataStatus, string> = {
  live: "Live",
  delayed: "Delayed",
  stale: "Stale",
  unavailable: "Unavailable",
  error: "Error",
};
