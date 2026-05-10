import type { OptionContract, Label, Direction, TriggerStatus } from "./types";
import { dteBucketFor, hasCostMismatch } from "./optionQualityValidator";
import { scoreContractQuality, type ContractTier, type ContractQualityResult } from "./contractQuality";

export { scoreContractQuality } from "./contractQuality";
export type { ContractTier, ContractQualityResult } from "./contractQuality";

export function evaluateContractQuality(
  contract: OptionContract,
  opts: { isLeaps?: boolean; isYolo?: boolean } = {},
): ContractQualityResult {
  return scoreContractQuality(contract, opts);
}

export function calculateThetaBurn(theta: number, ask: number): number {
  if (ask <= 0) return 0;
  return Math.abs(theta) / ask; // fraction per day
}

export function calculateBreakevenMove(
  type: Direction,
  breakeven: number,
  stockPrice: number
): number {
  if (stockPrice <= 0) return 0;
  return type === "CALL"
    ? (breakeven - stockPrice) / stockPrice
    : (stockPrice - breakeven) / stockPrice;
}

interface StockSetupInput {
  priorMomentum: boolean;
  above20: boolean;
  above50: boolean;
  above200: boolean;
  cleanBase: boolean;
  volumeImproving: boolean;
  sectorSupport: boolean;
}
export function scoreStockSetup(s: StockSetupInput): number {
  let pts = 0;
  if (s.priorMomentum) pts += 5;
  if (s.above20) pts += 4;
  if (s.above50) pts += 5;
  if (s.above200) pts += 6;
  if (s.cleanBase) pts += 5;
  if (s.volumeImproving) pts += 3;
  if (s.sectorSupport) pts += 2;
  return Math.min(30, pts);
}

interface OptionQualityInput {
  contract: OptionContract;
  isLeaps?: boolean;
  isYolo?: boolean;
}
export function scoreOptionQuality({ contract: c, isLeaps, isYolo }: OptionQualityInput): number {
  // DTE point band kept here (contract quality module is pure Greeks/liquidity).
  const r = scoreContractQuality(c, { isLeaps, isYolo });
  let pts = r.score;
  // DTE /5 (legacy slot)
  if (isLeaps) {
    if (c.dte >= 270 && c.dte <= 540) pts += 5;
    else if (c.dte >= 180) pts += 3;
  } else {
    if (c.dte >= 21 && c.dte <= 30) pts += 5;
    else if (c.dte >= 14 && c.dte <= 30) pts += 4;
    else if (c.dte >= 7) pts += 2;
  }
  return Math.min(40, pts);
}

interface RiskRewardInput {
  breakevenMovePct: number;
  entryNearSupport: boolean;
  resistanceRealistic: boolean;
  hasInvalidation: boolean;
  expectedMovePct?: number; // 1σ expected move over DTE (IV * sqrt(DTE/365))
}
export function scoreRiskReward(r: RiskRewardInput): number {
  let pts = 0;
  if (r.breakevenMovePct <= 0.03) pts += 5;
  else if (r.breakevenMovePct <= 0.06) pts += 3;
  else if (r.breakevenMovePct <= 0.1) pts += 1;
  if (r.entryNearSupport) pts += 4;
  if (r.resistanceRealistic) pts += 3;
  if (r.hasInvalidation) pts += 3;
  // Expected-move sanity: breakeven inside 1σ is a real edge.
  if (r.expectedMovePct && r.expectedMovePct > 0) {
    if (r.breakevenMovePct <= r.expectedMovePct * 0.5) pts += 3;
    else if (r.breakevenMovePct <= r.expectedMovePct) pts += 2;
    else if (r.breakevenMovePct <= r.expectedMovePct * 1.5) pts += 1;
  }
  return Math.min(15, pts);
}

export function calculateExpectedMovePct(iv: number, dte: number): number {
  if (iv <= 0 || dte <= 0) return 0;
  return iv * Math.sqrt(dte / 365);
}

interface MarketConfirmInput {
  spyQqqSupport: boolean;
  sectorSupport: boolean;
}
export function scoreMarketConfirmation(m: MarketConfirmInput): number {
  let pts = 0;
  if (m.spyQqqSupport) pts += 6;
  if (m.sectorSupport) pts += 4;
  return pts;
}

export function scoreRedditModifier(opts: {
  realCatalyst: boolean;
  risingDiscussion: boolean;
  hypeOnly: boolean;
  ivInflated: boolean;
}): number {
  let pts = 0;
  if (opts.realCatalyst) pts += 5;
  if (opts.risingDiscussion) pts += 3;
  if (opts.hypeOnly) pts -= 6;
  if (opts.ivInflated) pts -= 4;
  return Math.max(-10, Math.min(10, pts));
}

export function scoreRsBonus(beatingSpy: boolean): number {
  return beatingSpy ? 5 : 0;
}

export function scorePullbackSupportBonus(opts: {
  trueSupport: boolean;
  reclaim50: boolean;
  above200: boolean;
  volumeImproving: boolean;
}): number {
  let pts = 0;
  if (opts.trueSupport) pts += 4;
  if (opts.reclaim50) pts += 3;
  if (opts.above200) pts += 2;
  if (opts.volumeImproving) pts += 1;
  return Math.min(10, pts);
}

export function scorePivotBaseBonus(opts: {
  clearBase: boolean;
  pivotIdentified: boolean;
  triggerActive: boolean;
  invalidationClear: boolean;
}): number {
  let pts = 0;
  if (opts.clearBase) pts += 3;
  if (opts.pivotIdentified) pts += 3;
  if (opts.triggerActive) pts += 2;
  if (opts.invalidationClear) pts += 2;
  return Math.min(10, pts);
}

export function finalScore(parts: {
  stock: number;
  option: number;
  risk: number;
  market: number;
  reddit: number;
  rsBonus: number;
  pullbackBonus: number;
  pivotBonus: number;
}): number {
  const total =
    parts.stock + parts.option + parts.risk + parts.market +
    parts.reddit + parts.rsBonus + parts.pullbackBonus + parts.pivotBonus;
  return Math.max(0, Math.min(100, Math.round(total)));
}

export interface OverrideContext {
  contract: OptionContract;
  above200: boolean;
  above50OrReclaim: boolean;
  baseLowBroken: boolean;
  pivotFailed: boolean;
  redditOnlyThesis: boolean;
  triggerActive: boolean;
  isYolo?: boolean;
  isLeaps?: boolean;
  /** Contract Quality tier — caps label regardless of score. */
  contractTier?: ContractTier;
}

export function assignLabel(score: number, ctx: OverrideContext): Label {
  const c = ctx.contract;
  const absDelta = Math.abs(c.delta);

  // Contract Quality tier — hard cap before scoring decisions.
  if (ctx.contractTier === "avoid") return "Avoid";

  // Hard avoids
  if (c.spreadPct > 0.2) return "Avoid";
  if (c.spreadPct > 0.15 && !ctx.isYolo) return "Avoid";
  if (ctx.baseLowBroken) return "Avoid";

  let baseLabel: Label;
  if (score >= 85) baseLabel = "Buy Now";
  else if (score >= 75) baseLabel = "Watchlist";
  else if (score >= 65) baseLabel = "Aggressive";
  else if (score >= 50) baseLabel = "Lotto";
  else baseLabel = "Avoid";

  // Contract Quality tier caps
  const order: Label[] = ["Avoid", "Lotto", "Aggressive", "Watchlist", "Buy Now"];
  const cap = (max: Label): Label =>
    order.indexOf(baseLabel) <= order.indexOf(max) ? baseLabel : max;
  if (ctx.contractTier === "watchlistOnly") baseLabel = cap("Watchlist");
  if (ctx.contractTier === "yoloOnly") baseLabel = cap("Lotto");

  // Buy-Now downgrade rules
  if (baseLabel === "Buy Now") {
    if (!ctx.isLeaps && c.dte < 14) baseLabel = "Aggressive";
    if (c.thetaBurnPct > 0.08 && !ctx.isLeaps) baseLabel = "Watchlist";
    if (absDelta < 0.25 && !ctx.isYolo) baseLabel = "Watchlist";
    if (!ctx.above200) baseLabel = "Watchlist";
    if (!ctx.above50OrReclaim) baseLabel = "Aggressive";
    if (!ctx.triggerActive) baseLabel = "Watchlist";
    if (ctx.redditOnlyThesis) baseLabel = "Aggressive";
    if (ctx.pivotFailed) baseLabel = "Aggressive";
  }
  return baseLabel;
}

/**
 * Discipline penalty model.
 *
 * Applies negative deltas for failure modes that should NEVER score 100:
 *  - DTE outside scanner range:           -25
 *  - Trigger not active:                  -15
 *  - Breakout strike before breakout:     -15
 *  - Breakeven move > R2 reach (>8%):     -10
 *  - Cost mismatch (ask*100 ≠ stored):    -20
 *  - Missing/invalid quote/Greeks:        -25
 *  - YOLO/Lotto setup with normal swing:  -10 (downgrade)
 */
export interface DisciplineInput {
  contract: OptionContract;
  triggerStatus?: TriggerStatus;
  breakoutStrikeBeforeTrigger?: boolean;
  selectedContractFitsEntryMode?: boolean;
  triggerAmbiguous?: boolean;
  expirationComparisonMismatch?: boolean;
  breakevenMovePct: number;
  isLeaps?: boolean;
  isYolo?: boolean;
}

export interface DisciplinePenalty { reason: string; delta: number }

export function disciplinePenalties(p: DisciplineInput): DisciplinePenalty[] {
  const out: DisciplinePenalty[] = [];
  const c = p.contract;
  const bucket = dteBucketFor(c.dte);

  // DTE bucket validity per surface.
  const dteValid =
    (p.isLeaps && bucket === "leaps-only") ||
    (!p.isLeaps && (bucket === "swing-eligible" || bucket === "lotto-only" || bucket === "extended-swing" || (p.isYolo && bucket === "weekly-lotto")));
  if (!dteValid) out.push({ reason: `DTE ${c.dte} outside scanner range`, delta: -100 });

  if (p.breakoutStrikeBeforeTrigger) {
    out.push({ reason: "Breakout trigger not active for selected strike", delta: -20 });
  } else if (p.triggerStatus && p.triggerStatus !== "active") {
    out.push({ reason: `Trigger ${p.triggerStatus}`, delta: -15 });
  }
  if (p.triggerAmbiguous) {
    out.push({ reason: "Trigger status mixed/ambiguous", delta: -15 });
  }
  if (p.selectedContractFitsEntryMode === false) {
    out.push({ reason: "Selected strike does not fit active entry mode", delta: -15 });
  }
  if (p.breakevenMovePct > 0.08) {
    out.push({ reason: `Breakeven move ${(p.breakevenMovePct * 100).toFixed(1)}% > 8%`, delta: -10 });
  }
  if (hasCostMismatch(c)) {
    out.push({ reason: "Cost mismatch for selected price basis", delta: -20 });
  }
  if (p.expirationComparisonMismatch) out.push({ reason: "Broker comparison expiration mismatch", delta: -5 });
  if ((c.missingFields ?? []).some((f) => /^(delta|theta|iv|bid|ask|no-quote)$/.test(f))) {
    out.push({ reason: "Missing/invalid quote or Greeks", delta: -25 });
  }
  return out;
}

export function applyPenalties(score: number, penalties: DisciplinePenalty[]): number {
  const sum = penalties.reduce((a, b) => a + b.delta, 0);
  return Math.max(0, Math.min(100, Math.round(score + sum)));
}
