/**
 * Contract Repair / Better-Strike Search
 *
 * Pure (no I/O) ranking + nearby-strike search used BEFORE rejecting a
 * scanner pick. When the originally selected contract fails validation
 * (low OI, low volume, wide spread, missing data, bad breakeven, doesn't
 * fit the active entry mode, etc.) we don't immediately reject the
 * ticker — we search nearby contracts in the same chain and try to
 * find a better verified contract.
 *
 * Search policy (per spec):
 *   - CALLs: 3 strikes below + 5 strikes above the original strike
 *   - PUTs:  3 strikes above + 5 strikes below the original strike
 *   - Always include ATM / near-ATM strikes around current underlying
 *   - Always include strikes near the active trigger level
 *   - Same expiration first; if nothing valid, walk to the next
 *     expiration in the SAME DTE bucket.
 *
 * This module is unit-testable with no network calls. The chain pipeline
 * (`chain.functions.ts`) calls `searchBetterContract()` after fetching
 * the chain and validating the originally-selected contract.
 */

import type { Direction, EntryMode } from "./types";
import type { OptionContractData } from "./optionDataQuality";
import { validateOptionContract } from "./optionDataQuality";
import { dteBucketFor, type DteBucket } from "./optionQualityValidator";

// ---------- Public types ----------

export type RepairLabelHint =
  | "Buy Now Eligible"
  | "Watchlist / Buy on Trigger"
  | "Find Better Strike"
  | "Avoid Contract / Find Better Strike"
  | "Avoid Contract / No Valid Strike Found"
  | "Avoid Contract / Data Incomplete";

export interface ContractCandidateRow {
  optionTicker: string;
  expiration: string;
  strike: number;
  type: Direction;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  theta: number | null;
  iv: number | null;
  volume: number | null;
  openInterest: number | null;
  spreadPct: number | null;
  breakeven: number | null;
  breakevenVsTarget: BreakevenBand;
  entryModeFit: boolean;
  contractScore: number;
  selected: boolean;
  rejectionReasons: string[];
}

export type BreakevenBand =
  | "below T1"
  | "below T2"
  | "above T2"
  | "near R3"
  | "unknown";

export interface ContractRepairContext {
  direction: Direction;
  entryMode: EntryMode;
  underlyingPrice: number;
  /** Active breakout / reclaim trigger price (0 when unknown). */
  breakoutTrigger: number;
  /** Optional resistance / target levels to band breakeven against. */
  target1?: number;
  target2?: number;
  r3?: number;
  /** Whether the active trigger is firing. Drives the label hint. */
  triggerActive?: boolean;
  /** Whether the chart setup itself failed (forces Avoid Ticker upstream). */
  chartSetupFailed?: boolean;
}

export interface ContractRepairReport {
  originalSelected: ContractCandidateRow;
  originalRejectionReasons: string[];
  replacementSearchAttempted: boolean;
  replacementContractFound: boolean;
  replacementContract: ContractCandidateRow | null;
  replacementImprovementSummary: string | null;
  finalSelected: ContractCandidateRow;
  finalLabelHint: RepairLabelHint;
  candidates: ContractCandidateRow[];
}

// ---------- Delta target table per entry mode ----------

const DELTA_TARGETS: Record<EntryMode, [number, number]> = {
  "Support Reclaim": [0.4, 0.55],
  "Breakout": [0.3, 0.45],
  "Retest": [0.35, 0.5],
  "Momentum": [0.35, 0.5],
  "Lotto": [0.1, 0.3],
};

const DELTA_FLOOR = 0.25; // below this → no Buy Now (per spec)

// ---------- Scoring helpers ----------

function bandBreakeven(
  be: number | null,
  ctx: ContractRepairContext,
): BreakevenBand {
  if (be == null || !Number.isFinite(be)) return "unknown";
  const { direction, target1, target2, r3 } = ctx;
  // For PUTs, "below target" means above the breakdown target (smaller),
  // so we mirror the comparisons.
  const lt = (a: number, b: number) =>
    direction === "CALL" ? a <= b : a >= b;
  if (target1 != null && lt(be, target1)) return "below T1";
  if (target2 != null && lt(be, target2)) return "below T2";
  if (r3 != null && Math.abs(be - r3) / r3 <= 0.02) return "near R3";
  return "above T2";
}

function entryModeFitsContract(
  c: OptionContractData,
  ctx: ContractRepairContext,
): boolean {
  const { entryMode, direction, underlyingPrice, breakoutTrigger } = ctx;
  const strike = c.strikePrice;
  const absDelta = Math.abs(c.delta ?? 0);
  if (!Number.isFinite(strike) || !Number.isFinite(underlyingPrice) || underlyingPrice <= 0) {
    return false;
  }
  const [loD, hiD] = DELTA_TARGETS[entryMode];
  const deltaOk = absDelta >= loD && absDelta <= hiD;

  if (entryMode === "Support Reclaim") {
    const nearAtm = Math.abs(strike - underlyingPrice) / underlyingPrice <= 0.03;
    return nearAtm && deltaOk;
  }
  if (entryMode === "Breakout") {
    if (!Number.isFinite(breakoutTrigger) || breakoutTrigger <= 0) return deltaOk;
    // Strike should be near the breakout level (±5% of underlying).
    const nearBreak = Math.abs(strike - breakoutTrigger) / underlyingPrice <= 0.05;
    if (direction === "CALL") return deltaOk && (nearBreak || strike >= breakoutTrigger * 0.98);
    return deltaOk && (nearBreak || strike <= breakoutTrigger * 1.02);
  }
  if (entryMode === "Retest") {
    const nearAtm = Math.abs(strike - underlyingPrice) / underlyingPrice <= 0.04;
    return deltaOk && nearAtm;
  }
  if (entryMode === "Lotto") return deltaOk;
  return deltaOk;
}

interface ScoreParts {
  delta: number;
  oi: number;
  volume: number;
  spread: number;
  theta: number;
  iv: number;
  breakeven: number;
  entryModeFit: number;
}

interface ScoreOutput {
  score: number; // 0–100
  parts: ScoreParts;
  rejectionReasons: string[];
  isAvoid: boolean;
  noBuyNow: boolean;
}

function scoreCandidate(
  c: OptionContractData,
  ctx: ContractRepairContext,
): ScoreOutput {
  const reasons: string[] = [];
  let isAvoid = false;
  let noBuyNow = false;

  // ---- Hard data-presence avoids (bid/ask, Greeks, IV after repair)
  if (c.bid == null || c.ask == null || (c.bid ?? 0) <= 0 || (c.ask ?? 0) <= 0) {
    isAvoid = true;
    reasons.push("missing bid/ask after repair — avoid contract");
  }
  if (c.delta == null || c.gamma == null || c.theta == null || c.vega == null) {
    isAvoid = true;
    reasons.push("missing Greeks after repair — avoid contract");
  }
  if (c.impliedVolatility == null || (c.impliedVolatility ?? 0) <= 0) {
    isAvoid = true;
    reasons.push("missing IV after repair — avoid contract");
  }

  // ---- Delta /20
  const absDelta = Math.abs(c.delta ?? 0);
  const [loD, hiD] = DELTA_TARGETS[ctx.entryMode];
  let delta = 0;
  if (absDelta >= loD && absDelta <= hiD) delta = 20;
  else if (absDelta >= loD - 0.05 && absDelta <= hiD + 0.05) delta = 14;
  else if (absDelta >= 0.25) delta = 8;
  else {
    delta = 0;
    noBuyNow = true;
    reasons.push(`delta ${absDelta.toFixed(2)} below ${DELTA_FLOOR} — no Buy Now`);
  }

  // ---- OI /15
  const oi = c.openInterest ?? 0;
  let oiPts = 0;
  if (oi >= 1000) oiPts = 15;
  else if (oi >= 500) oiPts = 12;
  else if (oi >= 300) oiPts = 9;
  else if (oi >= 100) {
    oiPts = 4;
    noBuyNow = true;
    reasons.push(`OI ${oi} (100–299) — contract quality downgrade, no Buy Now`);
  } else {
    oiPts = 0;
    isAvoid = true;
    reasons.push(`OI ${oi} < 100 — avoid contract`);
  }

  // ---- Volume /15
  const vol = c.volume ?? 0;
  let volPts = 0;
  if (vol >= 1000) volPts = 15;
  else if (vol >= 250) volPts = 12;
  else if (vol >= 100) volPts = 8;
  else if (vol >= 50) {
    volPts = 3;
    noBuyNow = true;
    reasons.push(`volume ${vol} (50–99) — find better strike`);
  } else {
    volPts = 0;
    isAvoid = true;
    reasons.push(`volume ${vol} < 50 — avoid contract`);
  }

  // ---- Spread /15
  const sp = c.spreadPct ?? 1;
  let spPts = 0;
  if (sp < 0.05) spPts = 15;
  else if (sp <= 0.1) spPts = 12;
  else if (sp <= 0.15) spPts = 8;
  else if (sp <= 0.2) {
    spPts = 3;
    noBuyNow = true;
    reasons.push(`spread ${(sp * 100).toFixed(0)}% (15–20%) — find better strike`);
  } else {
    spPts = 0;
    isAvoid = true;
    reasons.push(`spread ${(sp * 100).toFixed(0)}% > 20% — avoid contract`);
  }

  // ---- Theta burn /10 (theta is negative; burn% = |theta|/ask)
  const ask = c.ask ?? 0;
  const theta = c.theta ?? 0;
  const burn = ask > 0 && Number.isFinite(theta) ? Math.abs(theta) / ask : 0;
  let thPts = 0;
  if (burn < 0.03) thPts = 10;
  else if (burn <= 0.05) thPts = 8;
  else if (burn <= 0.08) {
    thPts = 5;
    reasons.push(`theta burn ${(burn * 100).toFixed(1)}%/d — downgrade`);
  } else if (burn <= 0.1) {
    thPts = 1;
    noBuyNow = true;
    reasons.push(`theta burn ${(burn * 100).toFixed(1)}%/d > 8% — no Buy Now`);
  } else {
    thPts = 0;
    noBuyNow = true;
    reasons.push(`theta burn ${(burn * 100).toFixed(1)}%/d > 10% — lotto/avoid`);
  }

  // ---- IV /10 (c.impliedVolatility is 0–1)
  const ivPct = (c.impliedVolatility ?? 0) * 100;
  let ivPts = 0;
  if (ivPct === 0) {
    ivPts = 0;
    noBuyNow = true;
    reasons.push("IV missing — broker confirmation / repair required");
  } else if (ivPct < 45) ivPts = 10;
  else if (ivPct <= 60) ivPts = 8;
  else if (ivPct <= 70) ivPts = 5;
  else {
    ivPts = 1;
    noBuyNow = true;
    reasons.push(`IV ${ivPct.toFixed(0)}% > 70% — heavy penalty`);
  }

  // ---- Breakeven /10
  const beBand = bandBreakeven(c.breakeven, ctx);
  let bePts = 0;
  if (beBand === "below T1") bePts = 10;
  else if (beBand === "below T2") bePts = 7;
  else if (beBand === "above T2") {
    bePts = 3;
    reasons.push("breakeven above target 2 — downgrade");
  } else if (beBand === "near R3") {
    bePts = 0;
    noBuyNow = true;
    reasons.push("breakeven near/above R3 — no Buy Now");
  } else {
    bePts = 5; // unknown band — neutral
  }
  const beMovePct =
    c.breakeven != null && ctx.underlyingPrice > 0
      ? Math.abs(c.breakeven - ctx.underlyingPrice) / ctx.underlyingPrice
      : 0;
  if (beMovePct > 0.15) {
    isAvoid = true;
    reasons.push(`breakeven move ${(beMovePct * 100).toFixed(1)}% > 15% — avoid contract`);
  } else if (beMovePct > 0.08) {
    noBuyNow = true;
    reasons.push(`breakeven move ${(beMovePct * 100).toFixed(1)}% (8–15%) — find better strike`);
  }

  // ---- Entry-mode fit /5
  const fits = entryModeFitsContract(c, ctx);
  const fitPts = fits ? 5 : 0;
  if (!fits) {
    noBuyNow = true;
    reasons.push(`strike does not fit ${ctx.entryMode} entry mode`);
  }

  const score = delta + oiPts + volPts + spPts + thPts + ivPts + bePts + fitPts;
  return {
    score,
    parts: {
      delta, oi: oiPts, volume: volPts, spread: spPts,
      theta: thPts, iv: ivPts, breakeven: bePts, entryModeFit: fitPts,
    },
    rejectionReasons: reasons,
    isAvoid,
    noBuyNow,
  };
}

// ---------- Candidate selection ----------

function buildCandidatePool(
  original: OptionContractData,
  pool: OptionContractData[],
  ctx: ContractRepairContext,
): OptionContractData[] {
  // Same expiration + same type (calls vs puts) only.
  const sameSlate = pool.filter(
    (c) =>
      c.contractType === original.contractType &&
      c.expirationDate === original.expirationDate,
  );
  const sortedByStrike = sameSlate.slice().sort((a, b) => a.strikePrice - b.strikePrice);
  const idx = sortedByStrike.findIndex((c) => c.optionTicker === original.optionTicker);

  const directional: OptionContractData[] = [];
  if (idx >= 0) {
    // CALL: 3 below + 5 above. PUT: 3 above + 5 below.
    const below = ctx.direction === "CALL" ? 3 : 5;
    const above = ctx.direction === "CALL" ? 5 : 3;
    const lo = Math.max(0, idx - below);
    const hi = Math.min(sortedByStrike.length, idx + above + 1);
    directional.push(...sortedByStrike.slice(lo, hi));
  } else {
    directional.push(...sortedByStrike);
  }

  // Always include the 5 strikes nearest ATM.
  const nearAtm = sortedByStrike
    .slice()
    .sort((a, b) => Math.abs(a.strikePrice - ctx.underlyingPrice) - Math.abs(b.strikePrice - ctx.underlyingPrice))
    .slice(0, 5);

  // Always include the 5 strikes nearest the active trigger level.
  const nearTrigger =
    ctx.breakoutTrigger > 0
      ? sortedByStrike
          .slice()
          .sort((a, b) => Math.abs(a.strikePrice - ctx.breakoutTrigger) - Math.abs(b.strikePrice - ctx.breakoutTrigger))
          .slice(0, 5)
      : [];

  const seen = new Set<string>();
  const out: OptionContractData[] = [];
  for (const c of [...directional, ...nearAtm, ...nearTrigger]) {
    if (seen.has(c.optionTicker)) continue;
    seen.add(c.optionTicker);
    out.push(c);
  }
  return out;
}

function nextExpirationInBucket(
  current: string,
  bucket: DteBucket,
  pool: OptionContractData[],
): string | null {
  const sameBucket = Array.from(
    new Set(
      pool
        .filter((c) => dteBucketFor(c.dte) === bucket && c.expirationDate !== current)
        .map((c) => c.expirationDate),
    ),
  ).sort();
  // Pick the one chronologically just after `current`.
  const after = sameBucket.find((e) => e > current);
  return after ?? sameBucket[0] ?? null;
}

function toRow(
  c: OptionContractData,
  ctx: ContractRepairContext,
  selected: boolean,
  scored?: ScoreOutput,
): ContractCandidateRow {
  const s = scored ?? scoreCandidate(c, ctx);
  return {
    optionTicker: c.optionTicker,
    expiration: c.expirationDate,
    strike: c.strikePrice,
    type: c.contractType,
    bid: c.bid,
    ask: c.ask,
    delta: c.delta,
    theta: c.theta,
    iv: c.impliedVolatility,
    volume: c.volume,
    openInterest: c.openInterest,
    spreadPct: c.spreadPct,
    breakeven: c.breakeven,
    breakevenVsTarget: bandBreakeven(c.breakeven, ctx),
    entryModeFit: entryModeFitsContract(c, ctx),
    contractScore: s.score,
    selected,
    rejectionReasons: s.rejectionReasons,
  };
}

/**
 * Returns true when a candidate is a viable replacement (passes the
 * basic data-quality validator AND has no `isAvoid` blocker AND clears
 * the minimum thresholds: OI ≥ 300, volume ≥ 100, spread ≤ 15%).
 */
function isViable(c: OptionContractData, scored: ScoreOutput): boolean {
  if (scored.isAvoid) return false;
  const dq = validateOptionContract(c);
  if (!dq.isValidForBuyNow && !dq.isValidForWatchlist) return false;
  if ((c.openInterest ?? 0) < 300) return false;
  if ((c.volume ?? 0) < 100) return false;
  if ((c.spreadPct ?? 1) > 0.15) return false;
  return true;
}

/** Diff a few key metrics between original and replacement for the UI summary. */
function summarizeImprovement(
  original: OptionContractData,
  replacement: OptionContractData,
): string {
  const parts: string[] = [];
  const oi0 = original.openInterest ?? 0;
  const oi1 = replacement.openInterest ?? 0;
  if (oi1 > oi0) parts.push(`OI ${oi0} → ${oi1}`);
  const v0 = original.volume ?? 0;
  const v1 = replacement.volume ?? 0;
  if (v1 > v0) parts.push(`vol ${v0} → ${v1}`);
  const s0 = (original.spreadPct ?? 1) * 100;
  const s1 = (replacement.spreadPct ?? 1) * 100;
  if (s1 < s0) parts.push(`spread ${s0.toFixed(0)}% → ${s1.toFixed(0)}%`);
  const d0 = Math.abs(original.delta ?? 0);
  const d1 = Math.abs(replacement.delta ?? 0);
  if (Math.abs(d1 - d0) > 0.02) parts.push(`delta ${d0.toFixed(2)} → ${d1.toFixed(2)}`);
  if (original.expirationDate !== replacement.expirationDate) {
    parts.push(`exp ${original.expirationDate} → ${replacement.expirationDate}`);
  }
  if (original.strikePrice !== replacement.strikePrice) {
    parts.push(`strike $${original.strikePrice} → $${replacement.strikePrice}`);
  }
  return parts.length > 0 ? parts.join(", ") : "Replacement passes validation";
}

function rankReasons(scored: ScoreOutput): string[] {
  return scored.rejectionReasons;
}

// ---------- Main entrypoint ----------

export interface SearchInput {
  original: OptionContractData;
  chain: OptionContractData[];
  ctx: ContractRepairContext;
}

export function searchBetterContract(input: SearchInput): ContractRepairReport {
  const { original, chain, ctx } = input;
  const originalScore = scoreCandidate(original, ctx);
  const originalDq = validateOptionContract(original);

  // Original rejection reasons = score-driven blockers + missing data fields.
  const originalReasons = [...originalScore.rejectionReasons];
  if (!originalDq.isValidForBuyNow) {
    if (originalDq.missingFields.length > 0) {
      originalReasons.push(`missing fields: ${originalDq.missingFields.join(", ")}`);
    }
    for (const b of originalDq.blockers) originalReasons.push(b);
  }
  const originalEntryModeFit = entryModeFitsContract(original, ctx);
  if (!originalEntryModeFit) {
    originalReasons.push(`selected strike does not fit ${ctx.entryMode} entry mode`);
  }

  // Decide whether we even need to repair. Original passes if:
  //   - data quality is valid for Buy Now, AND
  //   - score has no "noBuyNow" / "isAvoid" blockers, AND
  //   - it fits the entry mode
  const needsRepair =
    !originalDq.isValidForBuyNow ||
    originalScore.isAvoid ||
    originalScore.noBuyNow ||
    !originalEntryModeFit;

  // ---------- Build & rank candidates ----------
  const sameExpPool = buildCandidatePool(original, chain, ctx);
  const sameExpRanked = sameExpPool
    .filter((c) => c.optionTicker !== original.optionTicker)
    .map((c) => ({ c, s: scoreCandidate(c, ctx) }))
    .sort((a, b) => b.s.score - a.s.score);

  let replacement: { c: OptionContractData; s: ScoreOutput } | null =
    sameExpRanked.find((r) => isViable(r.c, r.s)) ?? null;

  // If nothing on same expiration, walk to next expiration in same DTE bucket.
  let secondExpPool: OptionContractData[] = [];
  if (!replacement) {
    const bucket = dteBucketFor(original.dte);
    const nextExp = nextExpirationInBucket(original.expirationDate, bucket, chain);
    if (nextExp) {
      const proxy: OptionContractData = { ...original, expirationDate: nextExp };
      secondExpPool = buildCandidatePool(proxy, chain, ctx);
      const ranked = secondExpPool
        .filter((c) => c.optionTicker !== original.optionTicker)
        .map((c) => ({ c, s: scoreCandidate(c, ctx) }))
        .sort((a, b) => b.s.score - a.s.score);
      replacement = ranked.find((r) => isViable(r.c, r.s)) ?? null;
    }
  }

  // ---------- Build the candidate table (for UI) ----------
  const allPool = [...sameExpPool, ...secondExpPool];
  const candidateRows: ContractCandidateRow[] = allPool.map((c) => {
    const s = scoreCandidate(c, ctx);
    const isReplacement =
      replacement != null && c.optionTicker === replacement.c.optionTicker;
    return toRow(c, ctx, isReplacement, s);
  });
  // Always include the original at the top.
  const originalRow = toRow(original, ctx, !needsRepair, originalScore);
  candidateRows.unshift(originalRow);
  candidateRows.sort((a, b) => b.contractScore - a.contractScore);

  // ---------- Decide final selection + label hint ----------
  let finalSelected: ContractCandidateRow = originalRow;
  let replacementImprovementSummary: string | null = null;
  let replacementContract: ContractCandidateRow | null = null;
  let labelHint: RepairLabelHint;

  if (!needsRepair) {
    labelHint = ctx.triggerActive ? "Buy Now Eligible" : "Watchlist / Buy on Trigger";
  } else if (replacement) {
    const replRow = toRow(replacement.c, ctx, true, replacement.s);
    finalSelected = replRow;
    replacementContract = replRow;
    replacementImprovementSummary = summarizeImprovement(original, replacement.c);
    if (replacement.s.isAvoid || replacement.s.noBuyNow) {
      labelHint = "Watchlist / Buy on Trigger";
    } else {
      labelHint = ctx.triggerActive ? "Buy Now Eligible" : "Watchlist / Buy on Trigger";
    }
    // Mark the original row as not selected.
    for (const r of candidateRows) r.selected = r.optionTicker === replacement.c.optionTicker;
  } else {
    // No replacement found — figure out the right Avoid flavour.
    const greeksMissing =
      originalDq.missingFields.some((f) => /delta|gamma|theta|vega|impliedVolatility|bid|ask/.test(f));
    if (greeksMissing) labelHint = "Avoid Contract / Data Incomplete";
    else if (!originalEntryModeFit) labelHint = "Avoid Contract / Find Better Strike";
    else labelHint = "Avoid Contract / No Valid Strike Found";
  }

  return {
    originalSelected: originalRow,
    originalRejectionReasons: needsRepair ? Array.from(new Set(originalReasons)) : [],
    replacementSearchAttempted: needsRepair,
    replacementContractFound: replacement != null,
    replacementContract,
    replacementImprovementSummary,
    finalSelected,
    finalLabelHint: labelHint,
    candidates: candidateRows,
  };
}

// Re-export for tests.
export { scoreCandidate as _scoreCandidate, entryModeFitsContract as _entryModeFitsContract, rankReasons as _rankReasons };
