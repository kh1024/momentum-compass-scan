import type { OptionContract, Label, ExpirationBucket, EntryMode, TriggerStatus, CostValidationStatus } from "./types";

/**
 * DTE buckets aligned to scanner discipline. The legacy names are preserved
 * for backwards compatibility (callers that match on these strings still
 * compile). New code should prefer `expirationBucketFor()`.
 */
export type DteBucket =
  | "excluded"            // < 1 DTE — excluded
  | "weekly-lotto"        // 1–6 DTE — only in dedicated 0DTE/Weekly section
  | "lotto-only"          // 7–13 DTE — max label = Lotto/Aggressive
  | "swing-eligible"      // 14–30 DTE — eligible for Buy Now / Watchlist
  | "extended-swing"      // 31–45 DTE — only in Extended Swing section
  | "swing-plus"          // 46–60 DTE — Swing+ (separate section)
  | "excluded-short-term" // 61–179 DTE — outside any normal section
  | "leaps-only";         // 180–730 DTE — LEAPS only

export interface ValidationResult {
  ok: boolean;
  brokerConfirmRequired: boolean;
  missingFields: string[];
  dteBucket: DteBucket;
}

/** Bucket DTE per the scanner discipline rules. */
export function dteBucketFor(dte: number): DteBucket {
  if (!isFinite(dte) || dte < 1) return "excluded";
  if (dte <= 6) return "weekly-lotto";
  if (dte <= 13) return "lotto-only";
  if (dte <= 30) return "swing-eligible";
  if (dte <= 45) return "extended-swing";
  if (dte <= 60) return "swing-plus";
  if (dte < 180) return "excluded-short-term";
  if (dte <= 730) return "leaps-only";
  return "excluded";
}

/** Map raw DTE → user-facing expiration bucket label. */
export function expirationBucketFor(dte: number): ExpirationBucket {
  if (!isFinite(dte) || dte < 1) return "excluded";
  if (dte <= 6) return "weekly-lotto";
  if (dte <= 13) return "lotto-aggressive";
  if (dte <= 30) return "short-term-swing";
  if (dte <= 45) return "extended-swing";
  if (dte <= 60) return "swing-plus";
  if (dte < 180) return "excluded";
  if (dte <= 730) return "leaps";
  return "excluded";
}

export const EXPIRATION_BUCKET_LABEL: Record<ExpirationBucket, string> = {
  "weekly-lotto": "0–6D Weekly Lotto",
  "lotto-aggressive": "7–13D Lotto/Aggressive",
  "short-term-swing": "14–30D Short-Term Swing",
  "extended-swing": "31–45D Extended Swing",
  "swing-plus": "46–60D Swing+",
  "leaps": "180–730D LEAPS",
  "excluded": "Outside scanner buckets",
};

const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Validate a contract against the disciplined-pick rule set.
 *
 * A contract is **only** considered valid for a disciplined pick when ALL of:
 *  - strike is finite & positive
 *  - expiration parses to a real future calendar date (not past, not garbage)
 *  - bid is a finite NON-ZERO positive number (a zero-bid contract is unsellable)
 *  - ask is a finite positive number, ask ≥ bid, ask ≤ 50 × bid (sanity)
 *  - greeks (delta, theta) and iv are present and finite
 *  - volume ≥ 10 AND openInterest ≥ 50 (true liquidity floor — picks below this
 *    can't be exited cleanly even when the thesis is right)
 *  - spreadPct present and ≤ 15% (over 15% → broker confirm, over 25% → fail)
 *
 * Any failure adds a reason to `missingFields` and forces
 * `brokerConfirmRequired = true`, which downstream caps the label at Watchlist.
 */
export function validateContract(c: OptionContract): ValidationResult {
  const missing: string[] = [];

  // ---- Expiration ---------------------------------------------------------
  if (!c.expiration || typeof c.expiration !== "string") {
    missing.push("expiration");
  } else {
    const t = Date.parse(c.expiration);
    if (!Number.isFinite(t)) missing.push("expiration:unparseable");
    else {
      // Allow today; reject anything before today (already expired).
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (t < today.getTime()) missing.push("expiration:past");
    }
  }

  // ---- Strike -------------------------------------------------------------
  if (!num(c.strike) || c.strike <= 0) missing.push("strike");

  // ---- Bid / Ask quoting --------------------------------------------------
  // A 0-bid contract is effectively un-sellable; treat as missing.
  if (!num(c.bid) || c.bid <= 0) missing.push("bid:zero-or-missing");
  if (!num(c.ask) || c.ask <= 0) missing.push("ask");
  if (num(c.bid) && num(c.ask)) {
    if (c.ask < c.bid) missing.push("ask<bid");
    // Sanity: a quote where ask > 50× bid is almost certainly stale/garbage.
    if (c.bid > 0 && c.ask > c.bid * 50) missing.push("quote:unrealistic");
  }

  // ---- Greeks / IV --------------------------------------------------------
  if (!num(c.delta)) missing.push("delta");
  if (!num(c.theta)) missing.push("theta");
  if (!num(c.iv) || c.iv <= 0) missing.push("iv");

  // ---- Liquidity floor ----------------------------------------------------
  if (!num(c.volume) || c.volume < 0) missing.push("volume");
  else if (c.volume < 10) missing.push("volume<10");
  if (!num(c.openInterest) || c.openInterest < 0) missing.push("openInterest");
  else if (c.openInterest < 50) missing.push("oi<50");

  // ---- Spread realism -----------------------------------------------------
  if (!num(c.spreadPct) || c.spreadPct < 0) missing.push("spreadPct");
  else if (c.spreadPct > 0.25) missing.push("spread>25%");
  else if (c.spreadPct > 0.15) missing.push("spread>15%");

  const dteBucket = dteBucketFor(c.dte);
  const brokerConfirmRequired = missing.length > 0;
  return {
    ok: missing.length === 0,
    brokerConfirmRequired,
    missingFields: missing,
    dteBucket,
  };
}

export function costValidationStatus(c: OptionContract): CostValidationStatus {
  if (!num(c.cost)) return "unknown";
  const mid = num(c.mid) ? c.mid : num(c.bid) && num(c.ask) ? (c.bid + c.ask) / 2 : undefined;
  const basis = c.priceBasis ?? "unknown";
  if (basis === "ask") return num(c.ask) && c.ask > 0 && Math.abs(c.cost - c.ask * 100) <= 1 ? "valid ask cost" : "mismatch";
  if (basis === "mid") return num(mid) && mid > 0 && Math.abs(c.cost - mid * 100) <= 1 ? "valid mid cost" : "mismatch";
  if (basis === "last") return num(c.last) && c.last > 0 && Math.abs(c.cost - c.last * 100) <= 1 ? "valid last cost" : "mismatch";
  if (num(c.ask) && c.ask > 0 && Math.abs(c.cost - c.ask * 100) <= 1) return "valid ask cost";
  if (num(mid) && mid > 0 && Math.abs(c.cost - mid * 100) <= 1) return "valid mid cost";
  if (num(c.last) && c.last > 0 && Math.abs(c.cost - c.last * 100) <= 1) return "valid last cost";
  return "mismatch";
}

/** True when stored cost does not match its explicit price basis. */
export function hasCostMismatch(c: OptionContract): boolean {
  return costValidationStatus(c) === "mismatch";
}

/**
 * Hard label-discipline gate. Cap the candidate's label based on contract
 * verification, DTE bucket, AND live trigger status. Never upgrades — only
 * downgrades.
 *
 * Buy Now requires ALL of:
 *  - real chain contract (not mock/rescaled, no missing fields)
 *  - score ≥ 85
 *  - DTE in 14–30 (or LEAPS if isLeaps)
 *  - trigger active (price ≥ breakoutTrigger for breakout entries)
 *  - strike not above an inactive breakout trigger
 */
export function gateLabel(
  current: Label,
  opts: {
    brokerConfirmRequired: boolean;
    dteBucket: DteBucket;
    isLeaps?: boolean;
    isYolo?: boolean;
    triggerStatus?: TriggerStatus;
    entryMode?: EntryMode;
    breakoutStrikeBeforeTrigger?: boolean;
    selectedContractFitsEntryMode?: boolean;
    costMismatch?: boolean;
    breakevenMovePct?: number;
    buyNowBlockers?: string[];
    score?: number;
    /** When true, 31–45 DTE picks are rescored under Extended Swing rules and
     *  may earn Buy Now. When false (default behaviour for hidden surface),
     *  they are forced to Avoid. */
    extendedSwingEnabled?: boolean;
    /** Contract used for stricter Extended Swing quality checks. */
    contract?: { spreadPct: number; volume: number; openInterest: number; delta: number; thetaBurnPct: number };
  },
): Label {
  const order: Label[] = ["Avoid", "Lotto", "Aggressive", "Watchlist", "Buy Now"];
  const cap = (max: Label): Label =>
    order.indexOf(current) <= order.indexOf(max) ? current : max;

  // DTE first — hard avoids.
  if (opts.dteBucket === "excluded") return "Avoid";
  if (opts.dteBucket === "excluded-short-term" && !opts.isLeaps) return "Avoid";
  if (opts.dteBucket === "leaps-only" && !opts.isLeaps) return "Avoid";

  let next = current;

  if (opts.dteBucket === "weekly-lotto") {
    next = cap(opts.isYolo ? "Aggressive" : "Lotto");
  }
  if (opts.dteBucket === "lotto-only") {
    next = cap(opts.isYolo ? "Aggressive" : "Lotto");
  }

  // Extended-swing routing.
  if (opts.dteBucket === "extended-swing" && !opts.isLeaps) {
    if (!opts.extendedSwingEnabled) return "Avoid";
    // Stricter Extended Swing quality gate.
    const k = opts.contract;
    if (k) {
      const absD = Math.abs(k.delta);
      if (k.thetaBurnPct > 0.08) return "Avoid";
      if (k.spreadPct > 0.15) next = cap("Watchlist");
      if (k.volume < 100 || k.openInterest < 500) next = cap("Watchlist");
      if (absD < 0.35 || absD > 0.55) next = cap("Watchlist");
      if (k.thetaBurnPct > 0.05) next = cap("Watchlist");
    }
  }

  // Swing+ (46–60D) — treat like extended swing but slightly looser delta band.
  // Always allowed (no extendedSwingEnabled gate); routes to its own section.
  if (opts.dteBucket === "swing-plus" && !opts.isLeaps) {
    const k = opts.contract;
    if (k) {
      const absD = Math.abs(k.delta);
      if (k.thetaBurnPct > 0.06) next = cap("Watchlist");
      if (k.spreadPct > 0.15) next = cap("Watchlist");
      if (k.volume < 100 || k.openInterest < 300) next = cap("Watchlist");
      if (absD < 0.30 || absD > 0.60) next = cap("Watchlist");
    }
  }

  if (opts.brokerConfirmRequired) {
    next = order.indexOf(next) <= order.indexOf("Watchlist") ? next : "Watchlist";
  }

  if (next === "Buy Now" && opts.triggerStatus && opts.triggerStatus !== "active") {
    next = "Watchlist";
  }
  if (next === "Buy Now" && opts.breakoutStrikeBeforeTrigger) {
    next = "Watchlist";
  }
  if (next === "Buy Now" && opts.selectedContractFitsEntryMode === false) {
    next = "Watchlist";
  }
  if (next === "Buy Now" && opts.costMismatch) {
    next = "Watchlist";
  }
  if (next === "Buy Now" && typeof opts.breakevenMovePct === "number" && opts.breakevenMovePct > 0.08) {
    next = "Watchlist";
  }
  if (next === "Buy Now" && opts.buyNowBlockers && opts.buyNowBlockers.length > 0) {
    next = "Watchlist";
  }
  if (next === "Buy Now" && typeof opts.score === "number" && opts.score < 85) {
    next = "Watchlist";
  }
  return next;
}
