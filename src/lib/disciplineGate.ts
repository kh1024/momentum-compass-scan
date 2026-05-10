/**
 * Discipline Gate — single source of truth for the final label shown on a card.
 *
 * The UI MUST use only `displayLabel`. No other label (author/base/scoring/mock)
 * is allowed to leak into the trade card chip.
 *
 * Inputs come from a `TradeCandidate` already processed by `finalizeCandidate`
 * (which produced `setupScore`, `contractQualityScore`, `contractTier`,
 * `buyNowBlockers`, etc).
 *
 * Outputs:
 *   - baseLabel:           the scoring-engine label (pre-discipline)
 *   - finalLabel:          discipline-gate decision
 *   - displayLabel:        what the UI MUST render (== finalLabel)
 *   - buyNowEligible:      strict checklist below
 *   - buyNowBlockers:      concrete reasons (never "no explicit downgrade")
 *   - routedSection:       which section the card belongs to
 *   - visible:             whether the card appears at all
 *   - invariants:          10 invariant checks, each pass/fail with reason
 */

import type {
  Label,
  TradeCandidate,
  ExpirationBucket,
} from "./types";
import {
  dteBucketFor,
  expirationBucketFor,
  gateLabel,
  type DteBucket,
} from "./optionQualityValidator";
import { strikeIsBreakoutOnlyBeforeTrigger } from "./entryMode";

export type ScannerMode = "Strict" | "Balanced" | "Discovery";

export interface DisciplineGateOptions {
  extendedSwingEnabled: boolean;
  /** Scanner mode — controls warning bands for Watchlist/Aggressive without
   *  loosening the hard Buy Now rules. Default: "Balanced". */
  mode?: ScannerMode;
}

export interface InvariantCheck {
  id: number;
  name: string;
  pass: boolean;
  reason?: string;
}

export interface DisciplineGateResult {
  baseLabel: Label;
  finalLabel: Label;
  /** UI MUST render this — equals finalLabel. */
  displayLabel: Label;
  buyNowEligible: boolean;
  buyNowBlockers: string[];
  /** All concrete reasons for the chosen finalLabel (never empty). */
  reasons: string[];
  routedSection: ExpirationBucket | "hidden";
  visible: boolean;
  setupScore: number;
  contractScore: number;
  triggerScore: number;
  riskRewardScore: number;
  dataQualityScore: number;
  finalScore: number;
  dte: number;
  bucket: DteBucket;
  source: string;
  invariants: InvariantCheck[];
}

/**
 * Compute the data-quality sub-score (0–10): source, quote, Greeks, OI, vol.
 */
function dataQualityScore(c: TradeCandidate): number {
  const k = c.contract;
  let pts = 0;
  if (k.source === "chain") pts += 4;
  const missing = k.missingFields ?? [];
  if (!missing.some((f) => /quote|bid|ask|no-quote/.test(f))) pts += 2;
  if (!missing.some((f) => /delta|theta|iv/.test(f))) pts += 2;
  if (k.openInterest >= 300) pts += 1;
  if (k.volume >= 100) pts += 1;
  return pts;
}

function triggerScore(c: TradeCandidate): number {
  if (c.triggerStatus === "active") return 10;
  if (c.triggerStatus === "waiting-retest") return 5;
  if (c.triggerStatus === "stale") return 3;
  return 0;
}

function riskRewardScore(c: TradeCandidate): number {
  const be = c.contract.breakevenMovePct;
  if (!isFinite(be)) return 0;
  if (be <= 0.03) return 10;
  if (be <= 0.05) return 8;
  if (be <= 0.08) return 5;
  if (be <= 0.12) return 2;
  return 0;
}

/**
 * Buy Now eligibility checklist — used both as a hard gate and to populate
 * `buyNowBlockers`. Replaces the invalid "No explicit downgrade — author
 * label is Buy Now" reason. If ANY item below is false, Buy Now is impossible.
 */
function computeBuyNowChecklist(
  c: TradeCandidate,
  opts: { extendedSwingEnabled: boolean },
): { eligible: boolean; blockers: string[] } {
  const k = c.contract;
  const blockers: string[] = [];
  const missing = k.missingFields ?? [];
  const bucket = dteBucketFor(k.dte);
  const isLeaps = c.setupType === "LEAPS";

  if (k.source !== "chain") blockers.push("contract source not chain (mock/rescaled)");
  if (k.brokerConfirmRequired) blockers.push("broker confirmation required");
  if (missing.some((f) => /quote|bid|ask|no-quote|live-chain-not-loaded/.test(f))) blockers.push("quote not verified");
  if (missing.some((f) => /delta|theta|iv/.test(f))) blockers.push("Greeks not verified");
  if (k.volume < 50) blockers.push(`volume ${k.volume} < 50 — Avoid`);
  else if (k.volume < 100) blockers.push(`volume ${k.volume} (50–99) — find better strike`);
  if (k.openInterest < 100 && !isLeaps) blockers.push(`open interest ${k.openInterest} < 100 — Avoid`);
  else if (k.openInterest < 300 && !isLeaps) blockers.push(`open interest ${k.openInterest} < 300 — contract quality downgraded`);
  if (k.spreadPct > 0.20) blockers.push(`spread ${(k.spreadPct * 100).toFixed(0)}% > 20% — Avoid`);
  else if (k.spreadPct > 0.15) blockers.push(`spread ${(k.spreadPct * 100).toFixed(0)}% > 15% — find better strike`);
  if (k.thetaBurnPct > 0.08 && !isLeaps) blockers.push(`theta burn ${(k.thetaBurnPct * 100).toFixed(1)}%/d > 8%`);
  if (k.breakevenMovePct > 0.15) blockers.push(`breakeven move ${(k.breakevenMovePct * 100).toFixed(1)}% > 15% — Avoid`);
  else if (k.breakevenMovePct > 0.08) blockers.push(`breakeven move ${(k.breakevenMovePct * 100).toFixed(1)}% (8–15%) — find better strike`);
  if (k.costValidationStatus === "mismatch") blockers.push("cost mismatch");
  if (c.selectedContractFitsEntryMode === false) blockers.push("selected contract does not fit entry mode");
  if ((c.triggerStatus ?? "not-active") !== "active") blockers.push(`trigger ${c.triggerStatus ?? "not-active"}`);
  if (c.expirationComparison?.status === "not-comparable") blockers.push("expiration comparison mismatch");

  // DTE bucket / section routing
  if (bucket === "excluded") blockers.push(`DTE ${k.dte} excluded`);
  if (bucket === "excluded-short-term" && !isLeaps) blockers.push(`DTE ${k.dte} outside short-term`);
  if (bucket === "leaps-only" && !isLeaps) blockers.push(`DTE ${k.dte} LEAPS-only but setup is not LEAPS`);
  if (bucket === "extended-swing" && !opts.extendedSwingEnabled) blockers.push("Extended Swing section disabled");

  // Contract Quality tier hard cap
  if (c.contractTier && c.contractTier !== "buyNowEligible") {
    blockers.push(`contract tier ${c.contractTier}`);
  }

  // Final score floor
  const final = c.finalScore ?? c.score;
  if (final < 85) blockers.push(`final score ${final} < 85`);

  return { eligible: blockers.length === 0, blockers: Array.from(new Set(blockers)) };
}

/**
 * Section routing — DTE 33 with Extended Swing enabled lands in
 * "extended-swing"; with it disabled the card is hidden.
 */
function routeSection(
  c: TradeCandidate,
  opts: { extendedSwingEnabled: boolean },
): { section: ExpirationBucket | "hidden"; visible: boolean } {
  const k = c.contract;
  const bucket = expirationBucketFor(k.dte);
  const isLeaps = c.setupType === "LEAPS";

  if (bucket === "excluded") return { section: "hidden", visible: false };
  if (bucket === "extended-swing" && !isLeaps) {
    return opts.extendedSwingEnabled
      ? { section: "extended-swing", visible: true }
      : { section: "hidden", visible: false };
  }
  if (bucket === "leaps" && !isLeaps) return { section: "hidden", visible: false };
  return { section: bucket, visible: true };
}

export function runDisciplineGate(
  c: TradeCandidate,
  opts: DisciplineGateOptions,
): DisciplineGateResult {
  const k = c.contract;
  const isLeaps = c.setupType === "LEAPS";
  const isYolo = c.setupType === "Reddit YOLO";
  const dte = k.dte;
  const bucket = dteBucketFor(dte);

  const breakoutOnly = strikeIsBreakoutOnlyBeforeTrigger(
    c.direction,
    k.strike,
    c.breakoutTrigger ?? 0,
    c.triggerStatus ?? "not-active",
  );

  const checklist = computeBuyNowChecklist(c, opts);

  // Run the existing label gate as the canonical capper.
  const baseLabel = c.originalLabel ?? c.label;
  let finalLabel = gateLabel(c.label, {
    brokerConfirmRequired: k.brokerConfirmRequired ?? (k.source !== "chain"),
    dteBucket: bucket,
    isLeaps,
    isYolo,
    triggerStatus: c.triggerStatus,
    entryMode: c.entryMode,
    breakoutStrikeBeforeTrigger: breakoutOnly,
    selectedContractFitsEntryMode: c.selectedContractFitsEntryMode,
    costMismatch: k.costValidationStatus === "mismatch",
    breakevenMovePct: k.breakevenMovePct,
    buyNowBlockers: checklist.blockers,
    score: c.finalScore ?? c.score,
    extendedSwingEnabled: opts.extendedSwingEnabled,
    contract: k,
  });

  // Hard rule: if not Buy Now eligible, never display Buy Now.
  if (!checklist.eligible && finalLabel === "Buy Now") {
    finalLabel = "Watchlist";
  }

  // Hard avoids (chain data only — mock OI is synthetic).
  if (k.source === "chain") {
    if (k.openInterest < 100) finalLabel = "Avoid";          // OI < 100
    else if (k.volume < 50) finalLabel = "Avoid";             // volume < 50
    else if (k.spreadPct > 0.20) finalLabel = "Avoid";        // spread > 20%
    else if (k.breakevenMovePct > 0.15) finalLabel = "Avoid"; // breakeven > 15%
    else if (k.openInterest < 300) {
      // OI 100–299 → "find better strike" tier; downgrade Buy Now → Watchlist.
      // Only escalate to Avoid if volume is also weak (<50, handled above).
      if (finalLabel === "Buy Now") finalLabel = "Watchlist";
    }
  }

  // Selected strike doesn't fit the active entry mode → "Find Better Strike".
  // Takes precedence over Watchlist/Aggressive/Lotto, but Avoid (hard skip)
  // still wins.
  if (c.selectedContractFitsEntryMode === false && finalLabel !== "Avoid") {
    finalLabel = "Find Better Strike";
  }

  const route = routeSection(c, opts);

  // Massive Options Data Quality cap.
  const dq = k.dataQuality;
  if (dq) {
    if (dq.finalDataStatus === "avoid-data-incomplete") finalLabel = "Avoid";
    else if (dq.finalDataStatus === "broker-confirmation-required" && finalLabel === "Buy Now") {
      finalLabel = "Watchlist";
    }
  }

  // If hidden, force Avoid.
  if (!route.visible) finalLabel = "Avoid";

  // Reasons — the checklist itself drives this. Never the "no explicit
  // downgrade" fallback.
  const reasons: string[] = [];
  if (finalLabel === "Buy Now") {
    reasons.push("All Buy Now eligibility checks passed.");
  } else {
    if (checklist.blockers.length > 0) {
      reasons.push(...checklist.blockers.map((b) => `Blocker: ${b}`));
    } else {
      // Score-only downgrade.
      const final = c.finalScore ?? c.score;
      reasons.push(`Final score ${final} below Buy Now threshold (85).`);
    }
    if (!route.visible) reasons.push(`Section routing: hidden (bucket=${bucket}).`);
  }

  const result: DisciplineGateResult = {
    baseLabel,
    finalLabel,
    displayLabel: finalLabel,
    buyNowEligible: checklist.eligible && finalLabel === "Buy Now",
    buyNowBlockers: checklist.blockers,
    reasons,
    routedSection: route.section,
    visible: route.visible,
    setupScore: c.setupScore ?? c.score,
    contractScore: c.contractQualityScore ?? 0,
    triggerScore: triggerScore(c),
    riskRewardScore: riskRewardScore(c),
    dataQualityScore: dataQualityScore(c),
    finalScore: c.finalScore ?? c.score,
    dte,
    bucket,
    source: k.source ?? "mock-seed",
    invariants: [],
  };

  result.invariants = checkInvariants(c, result, opts);

  // Dev-only console warnings on invariant failure.
  if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    const failed = result.invariants.filter((i) => !i.pass);
    if (failed.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[disciplineGate] ${c.ticker} invariant failures:`, failed);
    }
  }

  return result;
}

function checkInvariants(
  c: TradeCandidate,
  r: DisciplineGateResult,
  opts: DisciplineGateOptions,
): InvariantCheck[] {
  const k = c.contract;
  const isLeaps = c.setupType === "LEAPS";
  const checks: InvariantCheck[] = [];
  const add = (id: number, name: string, pass: boolean, reason?: string) =>
    checks.push({ id, name, pass, reason: pass ? undefined : reason });

  add(1, "displayLabel == finalLabel", r.displayLabel === r.finalLabel,
    `displayLabel=${r.displayLabel}, finalLabel=${r.finalLabel}`);
  add(2, "Buy Now requires eligibility",
    !(r.displayLabel === "Buy Now" && !r.buyNowEligible),
    "Buy Now displayed but not eligible");
  add(3, "mock-seed cannot be Buy Now",
    !(k.source === "mock-seed" && r.displayLabel === "Buy Now"),
    "mock-seed displayed as Buy Now");
  add(4, "brokerConfirmRequired blocks Buy Now",
    !(k.brokerConfirmRequired && r.displayLabel === "Buy Now"),
    "brokerConfirmRequired but displayed Buy Now");
  add(5, "chain-not-loaded blocks Buy Now",
    !((k.missingFields ?? []).includes("live-chain-not-loaded") && r.displayLabel === "Buy Now"),
    "chain not loaded but displayed Buy Now");
  add(6, "trigger active required for Buy Now",
    !(r.displayLabel === "Buy Now" && (c.triggerStatus ?? "not-active") !== "active"),
    `trigger=${c.triggerStatus} but displayed Buy Now`);
  add(7, "hidden card cannot be Buy Now",
    !(!r.visible && r.displayLabel === "Buy Now"),
    "hidden but displayed Buy Now");
  // 8 + 9: Extended Swing routing
  const bucket = dteBucketFor(k.dte);
  if (bucket === "extended-swing" && !isLeaps) {
    if (opts.extendedSwingEnabled) {
      add(8, "Extended Swing routes to extended-swing section",
        r.routedSection === "extended-swing" && r.visible,
        `routed=${r.routedSection}, visible=${r.visible}`);
      add(9, "Extended Swing disabled → not applicable here", true);
    } else {
      add(8, "Extended Swing enabled → not applicable here", true);
      add(9, "Extended Swing disabled → Avoid + hidden",
        r.finalLabel === "Avoid" && !r.visible,
        `label=${r.finalLabel}, visible=${r.visible}`);
    }
  } else {
    add(8, "Not extended-swing — N/A", true);
    add(9, "Not extended-swing — N/A", true);
  }
  add(10, "No 'no explicit downgrade' reason allowed",
    !r.reasons.some((s) => /no explicit downgrade/i.test(s)),
    "found 'no explicit downgrade' reason");

  return checks;
}
