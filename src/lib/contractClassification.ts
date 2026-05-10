/**
 * Contract Selection / Classification Engine.
 *
 * Provides:
 *  - `classifyMoneyness`     → Deep ITM / ITM / Slightly ITM / ATM / Slightly OTM / OTM / Far OTM / Lottery OTM
 *  - `targetDeltaRange`      → delta band per entry mode + LEAPS/YOLO
 *  - `allowedMoneyness`      → which classifications are valid for a setup
 *  - `contractStyleTags`     → Balanced / Speculative / High Delta / Swing-Friendly / ...
 *  - `explainContractChoice` → human-readable "why this strike was chosen"
 *  - `passesQualityFloor`    → spread/OI/volume/IV sanity gate
 */
import type { Direction, EntryMode } from "./types";

export type Moneyness =
  | "Deep ITM"
  | "ITM"
  | "Slightly ITM"
  | "ATM"
  | "Slightly OTM"
  | "OTM"
  | "Far OTM"
  | "Lottery OTM";

export interface MoneynessResult {
  moneyness: Moneyness;
  /** Signed % from current price. Positive = strike above spot, negative = below. */
  strikeOffsetPct: number;
  /** Absolute % distance from current price. */
  strikeDistancePct: number;
  /** % move needed in underlying to reach break-even at expiration. */
  breakevenMovePct: number;
  /** True for ATM-ish contracts (≤1.5% from spot). */
  isAtm: boolean;
  /** True if strike is in-the-money for this direction. */
  isItm: boolean;
  /** Short human label e.g. "3.2% OTM", "ATM", "5.8% ITM". */
  label: string;
}

export interface ContractClassification extends MoneynessResult {
  /** Style tags surfaced on the card. */
  tags: ContractStyleTag[];
  /** Why this contract was selected. */
  explanation: string;
  /** Quality floor verdict and reasons (if any). */
  qualityFloor: { passes: boolean; warnings: string[] };
  /** Whether this contract's moneyness is acceptable for the active entry mode. */
  fitsEntryMode: boolean;
  /** When fitsEntryMode === false, the reason (e.g. "Far OTM unrealistic for High Conviction"). */
  fitsEntryModeReason?: string;
}

export type ContractStyleTag =
  | "Balanced"
  | "Conservative"
  | "Leverage"
  | "Speculative"
  | "High Delta"
  | "Swing-Friendly"
  | "Premium Heavy"
  | "Low Probability"
  | "Momentum Contract";

// ---------- Moneyness classification ----------

/**
 * Classify a strike's moneyness vs the underlying spot.
 *
 * Buckets use the absolute strike distance as a % of spot:
 *  - 0–1.5%   → ATM
 *  - 1.5–4%   → Slightly ITM / Slightly OTM
 *  - 4–8%     → ITM / OTM
 *  - 8–15%    → Deep ITM / Far OTM
 *  - >15%     → Deep ITM (calls below spot) / Lottery OTM (calls above spot)
 *
 * "ITM" means the option already has intrinsic value:
 *  - CALL: strike < spot
 *  - PUT:  strike > spot
 */
export function classifyMoneyness(
  direction: Direction,
  strike: number,
  underlyingPrice: number,
  breakeven?: number,
): MoneynessResult {
  if (!(underlyingPrice > 0) || !(strike > 0)) {
    return {
      moneyness: "ATM",
      strikeOffsetPct: 0,
      strikeDistancePct: 0,
      breakevenMovePct: 0,
      isAtm: true,
      isItm: false,
      label: "ATM",
    };
  }
  const offset = (strike - underlyingPrice) / underlyingPrice;
  const dist = Math.abs(offset);
  // For calls, negative offset (strike < spot) means ITM. For puts it's the opposite.
  const itm = direction === "CALL" ? offset < 0 : offset > 0;
  const isAtm = dist <= 0.015;

  let moneyness: Moneyness;
  if (isAtm) {
    moneyness = "ATM";
  } else if (dist <= 0.04) {
    moneyness = itm ? "Slightly ITM" : "Slightly OTM";
  } else if (dist <= 0.08) {
    moneyness = itm ? "ITM" : "OTM";
  } else if (dist <= 0.15) {
    moneyness = itm ? "Deep ITM" : "Far OTM";
  } else {
    moneyness = itm ? "Deep ITM" : "Lottery OTM";
  }

  const beMove =
    breakeven && breakeven > 0 ? (breakeven - underlyingPrice) / underlyingPrice : 0;
  const beMovePct = direction === "CALL" ? beMove : -beMove;

  const label = isAtm ? "ATM" : `${(dist * 100).toFixed(1)}% ${itm ? "ITM" : "OTM"}`;
  return {
    moneyness,
    strikeOffsetPct: offset,
    strikeDistancePct: dist,
    breakevenMovePct: beMovePct,
    isAtm,
    isItm: itm,
    label,
  };
}

// ---------- Target delta ranges (smarter selection) ----------

export interface DeltaTarget {
  min: number;
  max: number;
  ideal: number;
}

/**
 * Target delta range per setup category. Values are absolute (|delta|).
 *
 *  - High Conviction: 0.55–0.75   (Support Reclaim, strong Retest)
 *  - Near Entry:      0.45–0.65   (Breakout near trigger)
 *  - Momentum:        0.40–0.60
 *  - Aggressive:      0.25–0.45
 *  - Lottery:         0.10–0.25
 *  - LEAPS:           0.55–0.75   (ITM / ATM long-term)
 */
export function targetDeltaRange(opts: {
  entryMode: EntryMode;
  isLeaps?: boolean;
  isYolo?: boolean;
  /** When true, treat as "high conviction" — tightens band toward ITM. */
  highConviction?: boolean;
}): DeltaTarget {
  if (opts.isLeaps) return { min: 0.55, max: 0.8, ideal: 0.7 };
  if (opts.isYolo || opts.entryMode === "Lotto") return { min: 0.1, max: 0.25, ideal: 0.18 };
  if (opts.highConviction) return { min: 0.55, max: 0.75, ideal: 0.6 };
  switch (opts.entryMode) {
    case "Support Reclaim":
      return { min: 0.5, max: 0.7, ideal: 0.55 };
    case "Breakout":
      return { min: 0.45, max: 0.65, ideal: 0.5 };
    case "Retest":
      return { min: 0.45, max: 0.65, ideal: 0.52 };
    case "Momentum":
      return { min: 0.4, max: 0.6, ideal: 0.45 };
    default:
      return { min: 0.4, max: 0.6, ideal: 0.45 };
  }
}

// ---------- Allowed moneyness per setup ----------

export function allowedMoneyness(opts: {
  entryMode: EntryMode;
  isLeaps?: boolean;
  isYolo?: boolean;
  highConviction?: boolean;
}): Moneyness[] {
  if (opts.isLeaps) return ["Slightly ITM", "ITM", "ATM", "Slightly OTM"];
  if (opts.isYolo || opts.entryMode === "Lotto") return ["OTM", "Far OTM", "Lottery OTM"];
  if (opts.highConviction)
    return ["Slightly ITM", "ATM", "Slightly OTM", "ITM"];
  switch (opts.entryMode) {
    case "Support Reclaim":
      return ["Slightly ITM", "ATM", "Slightly OTM", "ITM"];
    case "Breakout":
    case "Retest":
      return ["ATM", "Slightly OTM", "Slightly ITM", "OTM"];
    case "Momentum":
      return ["ATM", "Slightly OTM", "OTM", "Slightly ITM"];
    default:
      return ["ATM", "Slightly OTM", "Slightly ITM"];
  }
}

// ---------- Quality floor ----------

export interface QualityFloorInput {
  spreadPct: number;
  openInterest: number;
  volume: number;
  iv: number; // 0–1
  bid: number;
  ask: number;
  dte: number;
  premium: number; // per-contract cost in $
}

export function passesQualityFloor(c: QualityFloorInput): { passes: boolean; warnings: string[] } {
  const w: string[] = [];
  if (!(c.bid > 0) || !(c.ask > 0)) w.push("no live quote");
  if (c.spreadPct > 0.25) w.push(`spread too wide (${(c.spreadPct * 100).toFixed(0)}%)`);
  else if (c.spreadPct > 0.15) w.push(`wide spread (${(c.spreadPct * 100).toFixed(0)}%)`);
  if (c.openInterest < 50) w.push(`thin OI (${c.openInterest})`);
  if (c.volume < 10) w.push(`thin volume (${c.volume})`);
  if (c.iv > 2.5) w.push(`absurd IV (${(c.iv * 100).toFixed(0)}%)`);
  if (c.premium > 5000 && c.dte < 180) w.push(`premium too heavy for short-dated ($${c.premium.toFixed(0)})`);
  // Hard fail = wider than 25% spread OR no quote OR OI<10
  const hardFail =
    !(c.bid > 0 && c.ask > 0) || c.spreadPct > 0.25 || c.openInterest < 10 || c.iv > 3;
  return { passes: !hardFail, warnings: w };
}

// ---------- Style tags ----------

export function contractStyleTags(opts: {
  moneyness: Moneyness;
  delta: number;
  entryMode: EntryMode;
  isLeaps?: boolean;
  isYolo?: boolean;
  premium: number;
  dte: number;
}): ContractStyleTag[] {
  const tags: ContractStyleTag[] = [];
  const absD = Math.abs(opts.delta);

  if (opts.isLeaps) tags.push("Conservative");
  if (absD >= 0.6) tags.push("High Delta");
  if (opts.moneyness === "ATM" || opts.moneyness === "Slightly ITM" || opts.moneyness === "Slightly OTM") {
    tags.push("Balanced");
  }
  if (opts.moneyness === "Far OTM" || opts.moneyness === "Lottery OTM") {
    tags.push("Speculative");
    tags.push("Low Probability");
  }
  if (opts.moneyness === "OTM" || opts.moneyness === "Slightly OTM") {
    tags.push("Leverage");
  }
  if (opts.dte >= 14 && opts.dte <= 60 && absD >= 0.4 && absD <= 0.65) {
    tags.push("Swing-Friendly");
  }
  if (opts.premium > 1500 && !opts.isLeaps) tags.push("Premium Heavy");
  if (opts.entryMode === "Momentum") tags.push("Momentum Contract");

  // Dedupe preserving order
  return Array.from(new Set(tags));
}

// ---------- Explanation ----------

export function explainContractChoice(opts: {
  moneyness: Moneyness;
  delta: number;
  entryMode: EntryMode;
  isLeaps?: boolean;
  isYolo?: boolean;
  fitsEntryMode: boolean;
  fitsEntryModeReason?: string;
  breakevenMovePct: number;
  direction: Direction;
}): string {
  if (!opts.fitsEntryMode && opts.fitsEntryModeReason) {
    return `⚠ ${opts.fitsEntryModeReason}`;
  }
  if (opts.isLeaps) {
    if (opts.moneyness === "ITM" || opts.moneyness === "Slightly ITM" || opts.moneyness === "Deep ITM")
      return `ITM LEAPS selected for long-term continuation with high delta (${opts.delta.toFixed(2)}).`;
    return `ATM/OTM LEAPS for long-term exposure (Δ ${opts.delta.toFixed(2)}).`;
  }
  if (opts.isYolo || opts.entryMode === "Lotto") {
    return `${opts.moneyness} contract classified as speculative lottery — high risk, low probability.`;
  }
  const be = (opts.breakevenMovePct * 100).toFixed(1);
  switch (opts.moneyness) {
    case "Deep ITM":
      return `Deep ITM for very high delta exposure (Δ ${opts.delta.toFixed(2)}); requires only +${be}% to break even.`;
    case "ITM":
      return `ITM contract for high-probability directional exposure (Δ ${opts.delta.toFixed(2)}).`;
    case "Slightly ITM":
      return `Slightly ITM for balanced delta with intrinsic-value cushion (Δ ${opts.delta.toFixed(2)}).`;
    case "ATM":
      return `ATM contract chosen for balanced delta exposure and best gamma response.`;
    case "Slightly OTM":
      return `Slightly OTM for leverage with reasonable probability of working (Δ ${opts.delta.toFixed(2)}).`;
    case "OTM":
      return `OTM for higher leverage; needs ~${be}% move to break even.`;
    case "Far OTM":
      return `Far OTM — aggressive leverage play, low probability without strong momentum.`;
    case "Lottery OTM":
      return `Lottery OTM — speculative only. Requires extreme move; expect to lose premium often.`;
  }
}

// ---------- Top-level classify ----------

export function classifyContract(opts: {
  direction: Direction;
  strike: number;
  underlyingPrice: number;
  breakeven: number;
  delta: number;
  entryMode: EntryMode;
  isLeaps?: boolean;
  isYolo?: boolean;
  highConviction?: boolean;
  quality: QualityFloorInput;
  premium: number;
  dte: number;
}): ContractClassification {
  const m = classifyMoneyness(opts.direction, opts.strike, opts.underlyingPrice, opts.breakeven);
  const allowed = allowedMoneyness({
    entryMode: opts.entryMode,
    isLeaps: opts.isLeaps,
    isYolo: opts.isYolo,
    highConviction: opts.highConviction,
  });
  const fits = allowed.includes(m.moneyness);
  const reason = fits
    ? undefined
    : `${m.moneyness} contract is not ideal for ${opts.highConviction ? "High Conviction" : opts.entryMode} setups (expected: ${allowed.join(", ")}).`;

  const qf = passesQualityFloor(opts.quality);
  const tags = contractStyleTags({
    moneyness: m.moneyness,
    delta: opts.delta,
    entryMode: opts.entryMode,
    isLeaps: opts.isLeaps,
    isYolo: opts.isYolo,
    premium: opts.premium,
    dte: opts.dte,
  });
  const explanation = explainContractChoice({
    moneyness: m.moneyness,
    delta: opts.delta,
    entryMode: opts.entryMode,
    isLeaps: opts.isLeaps,
    isYolo: opts.isYolo,
    fitsEntryMode: fits,
    fitsEntryModeReason: reason,
    breakevenMovePct: m.breakevenMovePct,
    direction: opts.direction,
  });

  return {
    ...m,
    tags,
    explanation,
    qualityFloor: qf,
    fitsEntryMode: fits,
    fitsEntryModeReason: reason,
  };
}
