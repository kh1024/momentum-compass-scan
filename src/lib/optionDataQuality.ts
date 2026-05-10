/**
 * Massive Options Data Quality Validator
 *
 * Pure validation of an option contract's data fields against the strict
 * Buy Now / Watchlist / Broker-Confirmation rules from the product spec.
 *
 * Repair (calling Massive's contract-snapshot or quotes endpoint) is
 * intentionally NOT done here — it lives in `optionRepair.server.ts` and
 * is injected via `runValidateAndRepair()` so this file stays unit-testable
 * with no I/O.
 */

import type { Direction } from "./types";

export type FinalDataStatus =
  | "verified"
  | "repaired"
  | "broker-confirmation-required"
  | "avoid-data-incomplete";

/** A single contract row, framework-agnostic. */
export interface OptionContractData {
  optionTicker: string;
  underlyingTicker: string;
  expirationDate: string;
  strikePrice: number;
  contractType: Direction;
  bid: number | null;
  ask: number | null;
  latestTrade: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  impliedVolatility: number | null;
  /** Set true when IV came from an estimator, not the chain — never Buy Now. */
  ivIsEstimated?: boolean;
  volume: number | null;
  openInterest: number | null;
  spreadPct: number | null;
  dte: number;
  breakeven: number | null;
  underlyingPrice: number | null;
}

export interface ValidateOptions {
  /** Whether the original chain contract has been repaired by snapshot/quote. */
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  /** Endpoint(s) tried during repair (for the report). */
  repairEndpoint?: "contract-snapshot" | "quotes" | "contract-snapshot+quotes" | null;
  /**
   * A nearby strike contract (same expiration / type) that passes validation
   * cleanly. Used to populate `recommendedReplacement`.
   */
  nearbyComplete?: OptionContractData | null;
}

export interface DataQualityResult {
  isValidForBuyNow: boolean;
  isValidForWatchlist: boolean;
  brokerConfirmationRequired: boolean;
  dataIncomplete: boolean;
  missingFields: string[];
  warnings: string[];
  blockers: string[];
  repairAttempted: boolean;
  repairSucceeded: boolean;
  repairEndpoint: ValidateOptions["repairEndpoint"];
  finalDataStatus: FinalDataStatus;
  /** Per-field verification flags for badge display. */
  verified: {
    quote: boolean;
    greeks: boolean;
    iv: boolean;
    volumeOI: boolean;
  };
  /** A nearby contract recommended in place of the original (when supplied). */
  recommendedReplacement: OptionContractData | null;
  /** Human-readable replacement reason (only set when replacement supplied). */
  replacementReason: string | null;
}

const REQUIRED_FIELDS: Array<keyof OptionContractData> = [
  "optionTicker",
  "expirationDate",
  "strikePrice",
  "contractType",
  "bid",
  "ask",
  "delta",
  "gamma",
  "theta",
  "vega",
  "impliedVolatility",
  "volume",
  "openInterest",
  "spreadPct",
  "dte",
  "breakeven",
  "underlyingPrice",
];

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function missingOf(c: OptionContractData): string[] {
  const missing: string[] = [];
  for (const k of REQUIRED_FIELDS) {
    const v = c[k];
    // Some fields are valid when 0 (volume/OI) — treat null/undefined as missing only.
    if (k === "volume" || k === "openInterest") {
      if (v === null || v === undefined) missing.push(k as string);
      continue;
    }
    if (!isPresent(v)) missing.push(k as string);
  }
  // bid/ask must be > 0 to count as a real quote.
  if ((c.bid ?? 0) <= 0 && !missing.includes("bid")) missing.push("bid");
  if ((c.ask ?? 0) <= 0 && !missing.includes("ask")) missing.push("ask");
  return Array.from(new Set(missing));
}

export function validateOptionContract(
  c: OptionContractData,
  opts: ValidateOptions = {},
): DataQualityResult {
  const missingFields = missingOf(c);
  const warnings: string[] = [];
  const blockers: string[] = [];

  const hasQuote = !missingFields.includes("bid") && !missingFields.includes("ask");
  const hasGreeks =
    !missingFields.includes("delta") &&
    !missingFields.includes("gamma") &&
    !missingFields.includes("theta") &&
    !missingFields.includes("vega");
  const hasIV = !missingFields.includes("impliedVolatility");
  const hasVolOI =
    !missingFields.includes("volume") && !missingFields.includes("openInterest");

  // Buy Now requires every required field to be present.
  let isValidForBuyNow = missingFields.length === 0;
  let isValidForWatchlist = hasQuote && hasGreeks;
  let brokerConfirmationRequired = false;
  let dataIncomplete = false;

  // Hard rules from spec.
  if (!hasQuote) {
    blockers.push("missing bid or ask — no Buy Now");
    isValidForBuyNow = false;
    isValidForWatchlist = false;
    brokerConfirmationRequired = true;
  }
  if (!hasGreeks) {
    blockers.push("missing Greeks — no Buy Now / no clean Watchlist");
    isValidForBuyNow = false;
    isValidForWatchlist = false;
    brokerConfirmationRequired = true;
  }
  if (!hasIV) {
    blockers.push("missing IV — Broker Confirmation Required");
    isValidForBuyNow = false;
    brokerConfirmationRequired = true;
  }
  if (c.ivIsEstimated) {
    warnings.push("IV is estimated, not from chain — never Buy Now");
    isValidForBuyNow = false;
  }
  if (!hasVolOI) {
    blockers.push("missing volume or open interest — no Buy Now");
    isValidForBuyNow = false;
  }

  // Repair outcome controls final status.
  const repairAttempted = !!opts.repairAttempted;
  const repairSucceeded = !!opts.repairSucceeded;
  const repairEndpoint = opts.repairEndpoint ?? null;

  let finalDataStatus: FinalDataStatus;
  if (missingFields.length === 0) {
    finalDataStatus = repairAttempted && repairSucceeded ? "repaired" : "verified";
  } else if (!hasQuote && !hasGreeks) {
    // Critical fields still missing after repair.
    finalDataStatus = repairAttempted ? "avoid-data-incomplete" : "broker-confirmation-required";
    dataIncomplete = repairAttempted;
  } else {
    finalDataStatus = "broker-confirmation-required";
  }

  // If repair was attempted and didn't fix the missing critical fields, force
  // avoid-data-incomplete per spec.
  if (repairAttempted && !repairSucceeded && (!hasQuote || !hasGreeks)) {
    finalDataStatus = "avoid-data-incomplete";
    dataIncomplete = true;
    blockers.push("repair failed — data incomplete");
  }

  const recommendedReplacement = opts.nearbyComplete ?? null;
  const replacementReason = recommendedReplacement
    ? "Original contract rejected due to missing data. Replaced with nearest verified contract."
    : null;

  return {
    isValidForBuyNow,
    isValidForWatchlist,
    brokerConfirmationRequired,
    dataIncomplete,
    missingFields,
    warnings,
    blockers,
    repairAttempted,
    repairSucceeded,
    repairEndpoint,
    finalDataStatus,
    verified: { quote: hasQuote, greeks: hasGreeks, iv: hasIV, volumeOI: hasVolOI },
    recommendedReplacement,
    replacementReason,
  };
}

/**
 * Find a nearby strike (same expiration + same call/put type) within ±N
 * strikes of the original that passes the strict validator cleanly AND has
 * volume ≥ 100, OI ≥ 300, spread ≤ 15%.
 */
export function findNearbyCompleteStrike(
  original: OptionContractData,
  candidates: OptionContractData[],
  opts: { maxStrikesAway?: number; targetDeltaRange?: [number, number] } = {},
): OptionContractData | null {
  const max = opts.maxStrikesAway ?? 3;
  const sameSlate = candidates.filter(
    (c) =>
      c.contractType === original.contractType &&
      c.expirationDate === original.expirationDate &&
      c.optionTicker !== original.optionTicker,
  );
  // Sort by absolute strike distance, take the N nearest.
  const nearest = sameSlate
    .map((c) => ({ c, dist: Math.abs(c.strikePrice - original.strikePrice) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, max * 2);
  for (const { c } of nearest) {
    const r = validateOptionContract(c);
    if (!r.isValidForBuyNow) continue;
    if ((c.volume ?? 0) < 100) continue;
    if ((c.openInterest ?? 0) < 300) continue;
    if ((c.spreadPct ?? 1) > 0.15) continue;
    if (opts.targetDeltaRange) {
      const [lo, hi] = opts.targetDeltaRange;
      const d = Math.abs(c.delta ?? 0);
      if (d < lo || d > hi) continue;
    }
    return c;
  }
  return null;
}
