/**
 * Derives moneyness display info for a TradeCandidate even when chain
 * enrichment didn't attach a full classification (e.g. mock-seed,
 * provider failure, pre-enrich first paint).
 *
 * Always returns a label like "ATM" / "2.1% OTM" / "4.8% ITM" and the
 * Moneyness bucket so list views never show a blank cell.
 */
import type { TradeCandidate } from "./types";
import {
  classifyMoneyness,
  type Moneyness,
  type MoneynessResult,
} from "./contractClassification";

export interface DerivedMoneyness extends MoneynessResult {
  /** True when this came from a full chain classification (vs synthesized). */
  fromChain: boolean;
}

export function derivedMoneyness(t: TradeCandidate): DerivedMoneyness {
  const c = t.contract;
  if (c.classification) {
    return {
      moneyness: c.classification.moneyness,
      strikeOffsetPct: c.classification.strikeOffsetPct,
      strikeDistancePct: c.classification.strikeDistancePct,
      breakevenMovePct: c.classification.breakevenMovePct,
      isAtm: c.classification.isAtm,
      isItm: c.classification.isItm,
      label: c.classification.label,
      fromChain: true,
    };
  }
  const res = classifyMoneyness(t.direction, c.strike, t.price, c.breakeven);
  return { ...res, fromChain: false };
}

export function moneynessLabel(t: TradeCandidate): string {
  return derivedMoneyness(t).label;
}

export function moneynessBucket(t: TradeCandidate): Moneyness {
  return derivedMoneyness(t).moneyness;
}
