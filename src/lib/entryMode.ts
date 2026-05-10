/**
 * Entry-mode classifier and trigger evaluator.
 *
 * Maps the curated `setupType` (already in candidate data) to a concrete
 * `EntryMode` and computes the live `TriggerStatus` from current price vs
 * the resolved breakout/reclaim level.
 */
import type {
  TradeCandidate,
  EntryMode,
  TriggerStatus,
  Levels,
  Direction,
  SetupType,
  EntryTriggerDetail,
  FinalTriggerUsed,
} from "./types";

const SETUP_TO_ENTRY: Record<SetupType, EntryMode> = {
  "Pullback-to-Support": "Support Reclaim",
  "Pivot/Base Breakout": "Breakout",
  "Pivot/Base Retest": "Retest",
  "Short-Term Momentum": "Momentum",
  "Reddit YOLO": "Lotto",
  "LEAPS": "Momentum",
  "Failed Breakout": "Momentum",
  "Resistance Rejection": "Breakout",
  "Breakdown": "Breakout",
};

export function entryModeFromSetup(setup: SetupType): EntryMode {
  return SETUP_TO_ENTRY[setup] ?? "Momentum";
}

/**
 * Resolve the numeric breakout/reclaim trigger price the scanner is
 * watching for this candidate. For calls: baseHigh (or pivot if higher).
 * For puts: baseLow. Used by the trigger gate AND the comparison panel.
 */
export function resolveBreakoutTrigger(
  direction: Direction,
  entryMode: EntryMode,
  levels: Levels,
): number {
  if (direction === "CALL") {
    if (entryMode === "Support Reclaim") {
      // Reclaim trigger = pivot or 20DMA (whichever is meaningful & finite).
      return Math.max(levels.pivot ?? 0, levels.dma20 ?? 0);
    }
    // Breakout / Retest / Momentum / Lotto track baseHigh.
    return Math.max(levels.baseHigh ?? 0, levels.pivot ?? 0);
  }
  // PUTs: trigger is breakdown of baseLow / pivot.
  return Math.min(levels.baseLow ?? Infinity, levels.pivot ?? Infinity);
}

function finiteLevel(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function levelDistancePct(price: number, level: number): number {
  return price > 0 && Number.isFinite(level) ? Math.abs(price - level) / price : Infinity;
}

function callPutStatus(direction: Direction, price: number, level: number): TriggerStatus {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(level) || level <= 0) return "not-active";
  if (levelDistancePct(price, level) > 0.1) return "stale";
  if (direction === "CALL") return price >= level ? "active" : "not-active";
  return price <= level ? "active" : "not-active";
}

export function splitTriggerStates(
  direction: Direction,
  price: number,
  levels: Levels,
): {
  supportReclaimTrigger: EntryTriggerDetail;
  breakoutTriggerState: EntryTriggerDetail;
  retestTrigger: EntryTriggerDetail;
} {
  const supportLevel = direction === "CALL"
    ? Math.max(finiteLevel(levels.pivot), finiteLevel(levels.dma20))
    : Math.min(finiteLevel(levels.pivot) || Infinity, finiteLevel(levels.dma20) || Infinity);
  const breakoutLevel = direction === "CALL"
    ? Math.max(finiteLevel(levels.baseHigh), finiteLevel(levels.r1), finiteLevel(levels.pivot))
    : Math.min(finiteLevel(levels.baseLow) || Infinity, finiteLevel(levels.s1) || Infinity, finiteLevel(levels.pivot) || Infinity);
  const retestLevel = direction === "CALL"
    ? Math.max(finiteLevel(levels.baseHigh), finiteLevel(levels.pivot))
    : Math.min(finiteLevel(levels.baseLow) || Infinity, finiteLevel(levels.pivot) || Infinity);
  const breakoutStatus = callPutStatus(direction, price, breakoutLevel);
  const retestRaw = evaluateTriggerStatus(direction, "Retest", price, retestLevel, levels);
  return {
    supportReclaimTrigger: { level: supportLevel, status: callPutStatus(direction, price, supportLevel) },
    breakoutTriggerState: { level: breakoutLevel, status: breakoutStatus },
    retestTrigger: { level: retestLevel, status: retestRaw === "active" ? "active" : retestRaw === "waiting-retest" ? "waiting-retest" : "not-active" },
  };
}

export function inferSelectedContractMode(
  direction: Direction,
  price: number,
  strike: number,
  breakoutLevel: number,
): EntryMode {
  if (!Number.isFinite(strike) || !Number.isFinite(price) || price <= 0) return "Momentum";
  if (Number.isFinite(breakoutLevel) && breakoutLevel > 0) {
    if (direction === "CALL" && strike >= breakoutLevel) return "Breakout";
    if (direction === "PUT" && strike <= breakoutLevel) return "Breakout";
  }
  return "Support Reclaim";
}

export function selectedContractFitsEntryMode(c: TradeCandidate, selectedMode: EntryMode): boolean {
  const strike = c.contract.strike;
  const price = c.price;
  const delta = Math.abs(c.contract.delta);
  if (!Number.isFinite(strike) || !Number.isFinite(price) || price <= 0) return false;
  if (c.entryMode === "Breakout") return selectedMode === "Breakout";
  if (c.entryMode === "Retest") return selectedMode === "Retest" || selectedMode === "Support Reclaim";
  if (c.entryMode === "Support Reclaim") {
    const nearAtm = Math.abs(strike - price) / price <= 0.03;
    const preferredDelta = delta >= 0.4 && delta <= 0.55;
    return selectedMode === "Support Reclaim" && nearAtm && preferredDelta;
  }
  return true;
}

export function finalTriggerForSelection(entryMode: EntryMode, selectedMode: EntryMode): FinalTriggerUsed {
  if (selectedMode === "Breakout") return "breakout";
  if (entryMode === "Retest") return "retest";
  if (entryMode === "Support Reclaim") return "support reclaim";
  return "momentum";
}

/**
 * Compute live trigger status from current price vs trigger level.
 *  - "active"     CALL: price >= trigger.  PUT: price <= trigger.
 *  - "not-active" otherwise.
 *  - For "Retest" entries we mark "waiting-retest" if price is BELOW
 *    trigger but still inside the base, signalling a pullback test.
 */
export function evaluateTriggerStatus(
  direction: Direction,
  entryMode: EntryMode,
  price: number,
  trigger: number,
  levels: Levels,
): TriggerStatus {
  if (!isFinite(price) || !isFinite(trigger) || trigger <= 0) return "not-active";
  if (direction === "CALL") {
    if (price >= trigger) return "active";
    if (entryMode === "Retest") {
      // Already broke out earlier and is now retesting baseHigh from above
      // is "active"; from below but still above baseMid is "waiting-retest".
      const baseMid = levels.baseMid ?? 0;
      if (price >= baseMid) return "waiting-retest";
    }
    return "not-active";
  }
  // PUT
  if (price <= trigger) return "active";
  if (entryMode === "Retest") {
    const baseMid = levels.baseMid ?? Infinity;
    if (price <= baseMid) return "waiting-retest";
  }
  return "not-active";
}

/**
 * For a CALL: is the chosen strike a "breakout-only" strike (above the
 * breakout trigger) being shown BEFORE the breakout has fired?
 *
 * Returns true when:
 *   strike > breakoutTrigger AND triggerStatus !== "active"
 */
export function strikeIsBreakoutOnlyBeforeTrigger(
  direction: Direction,
  strike: number,
  breakoutTrigger: number,
  triggerStatus: TriggerStatus,
): boolean {
  if (triggerStatus === "active") return false;
  if (!isFinite(strike) || !isFinite(breakoutTrigger) || breakoutTrigger <= 0) return false;
  if (direction === "CALL") return strike > breakoutTrigger;
  return strike < breakoutTrigger;
}

/**
 * Apply entry-mode + trigger metadata to a candidate (pure — returns a new
 * object; does not mutate). Safe to call repeatedly.
 */
export function applyEntryAndTrigger(c: TradeCandidate): TradeCandidate {
  const entryMode = c.entryMode ?? entryModeFromSetup(c.setupType);
  const split = splitTriggerStates(c.direction, c.price, c.levels);
  const selectedContractMode = inferSelectedContractMode(
    c.direction,
    c.price,
    c.contract.strike,
    split.breakoutTriggerState.level,
  );
  const finalTriggerUsedForLabel = finalTriggerForSelection(entryMode, selectedContractMode);
  const triggerStatus = finalTriggerUsedForLabel === "breakout"
    ? split.breakoutTriggerState.status
    : finalTriggerUsedForLabel === "retest"
      ? split.retestTrigger.status
      : finalTriggerUsedForLabel === "support reclaim"
        ? split.supportReclaimTrigger.status
        : evaluateTriggerStatus(c.direction, entryMode, c.price, resolveBreakoutTrigger(c.direction, entryMode, c.levels), c.levels);
  return {
    ...c,
    entryMode,
    breakoutTrigger: split.breakoutTriggerState.level,
    triggerStatus,
    supportReclaimTrigger: split.supportReclaimTrigger,
    breakoutTriggerState: split.breakoutTriggerState,
    retestTrigger: split.retestTrigger,
    selectedContractMode,
    selectedContractFitsEntryMode: selectedContractFitsEntryMode({ ...c, entryMode }, selectedContractMode),
    finalTriggerUsedForLabel,
  };
}
