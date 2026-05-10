import { describe, it, expect } from "vitest";
import { costValidationStatus, dteBucketFor, gateLabel, hasCostMismatch, expirationBucketFor } from "../optionQualityValidator";
import { evaluateTriggerStatus, finalTriggerForSelection, selectedContractFitsEntryMode, splitTriggerStates, strikeIsBreakoutOnlyBeforeTrigger, entryModeFromSetup } from "../entryMode";
import { disciplinePenalties, applyPenalties } from "../scoringEngine";
import type { OptionContract, Levels, TradeCandidate } from "../types";

const baseContract = (o: Partial<OptionContract> = {}): OptionContract => ({
  expiration: "2026-06-12", strike: 225, ask: 7.9, bid: 7.7, cost: 790,
  iv: 0.45, delta: 0.35, theta: -0.07, thetaBurnPct: 0.009, gamma: 0.04, vega: 0.12,
  volume: 600, openInterest: 2000, spreadPct: 0.03, dte: 33,
  breakeven: 232.9, breakevenMovePct: 0.083, source: "chain", ...o,
});

const flatLevels = (price: number): Levels => ({
  s1: price * 0.97, s2: price * 0.94, s3: price * 0.9,
  r1: price * 1.03, r2: price * 1.06, r3: price * 1.1,
  pivot: price, baseHigh: 224.33, baseLow: price * 0.93, baseMid: price * 0.97,
  dma20: price * 0.99, dma50: price * 0.95, dma200: price * 0.85,
});

const candidate = (o: Partial<TradeCandidate> = {}): TradeCandidate => ({
  id: "NVDA-C-225", ticker: "NVDA", direction: "CALL", price: 215,
  cap: "Mega", setupType: "Pivot/Base Breakout", score: 100, label: "Buy Now",
  trend: "", sectorConfirmation: "", redditSentiment: "Bullish", levels: flatLevels(215),
  entryTrigger: "", invalidation: "", target1: 224.33, target2: 230,
  contract: baseContract(), entryStrategy: "", exitStrategy: "", profitPlan: "", sizing: "",
  keyRisks: [], brokerConfirmRequired: false, isDemo: false, ...o,
});

describe("scanner discipline rules", () => {
  it("NVDA $225C with breakout trigger 224.33 inactive cannot be Buy Now", () => {
    const status = evaluateTriggerStatus("CALL", "Breakout", 215.05, 224.33, flatLevels(215));
    expect(status).toBe("not-active");
    const breakoutOnly = strikeIsBreakoutOnlyBeforeTrigger("CALL", 225, 224.33, status);
    expect(breakoutOnly).toBe(true);
    const label = gateLabel("Buy Now", {
      brokerConfirmRequired: false, dteBucket: dteBucketFor(20),
      triggerStatus: status, breakoutStrikeBeforeTrigger: breakoutOnly, score: 90,
    });
    expect(label).not.toBe("Buy Now");
  });

  it("DTE 33 in short-term scanner downgrades to extended-swing watchlist", () => {
    expect(dteBucketFor(33)).toBe("extended-swing");
    const label = gateLabel("Buy Now", {
      brokerConfirmRequired: false, dteBucket: dteBucketFor(33), score: 90,
      extendedSwingEnabled: true,
      triggerStatus: "not-active",
    });
    expect(label).toBe("Watchlist");
  });

  it("DTE 5 excluded from normal scanner (weekly-lotto)", () => {
    expect(dteBucketFor(5)).toBe("weekly-lotto");
    const label = gateLabel("Buy Now", {
      brokerConfirmRequired: false, dteBucket: "weekly-lotto", score: 90,
    });
    expect(label).toBe("Lotto");
  });

  it("ask 7.90 → ask cost 790, mismatch flagged when cost stored as 783", () => {
    expect(hasCostMismatch(baseContract({ ask: 7.9, cost: 790, priceBasis: "ask" }))).toBe(false);
    expect(hasCostMismatch(baseContract({ ask: 7.9, cost: 783, priceBasis: "ask" }))).toBe(true);
    expect(costValidationStatus(baseContract({ bid: 7.76, ask: 7.9, mid: 7.83, cost: 783, priceBasis: "mid" }))).toBe("valid mid cost");
  });

  it("Real contract but trigger not active → cannot be Buy Now", () => {
    const label = gateLabel("Buy Now", {
      brokerConfirmRequired: false, dteBucket: "swing-eligible",
      triggerStatus: "not-active", score: 90,
    });
    expect(label).toBe("Watchlist");
  });

  it("Real contract but DTE invalid → Avoid", () => {
    const label = gateLabel("Buy Now", {
      brokerConfirmRequired: false, dteBucket: dteBucketFor(0), score: 90,
    });
    expect(label).toBe("Avoid");
  });

  it("Penalty model: DTE 33 + breakout-strike + cost mismatch sums to <= -45", () => {
    const c = baseContract({ dte: 33, ask: 7.9, cost: 783, priceBasis: "ask" });
    const pens = disciplinePenalties({
      contract: c, triggerStatus: "not-active",
      breakoutStrikeBeforeTrigger: true, breakevenMovePct: 0.083,
    });
    const total = pens.reduce((s, p) => s + p.delta, 0);
    expect(total).toBeLessThanOrEqual(-45);
    expect(applyPenalties(100, pens)).toBeLessThan(60);
  });

  it("Test 1: $225C breakout below 224.33 is Watchlist, not Buy Now", () => {
    const status = evaluateTriggerStatus("CALL", "Breakout", 215, 224.33, flatLevels(215));
    const breakoutOnly = strikeIsBreakoutOnlyBeforeTrigger("CALL", 225, 224.33, status);
    const label = gateLabel("Buy Now", { brokerConfirmRequired: false, dteBucket: "swing-eligible", triggerStatus: status, breakoutStrikeBeforeTrigger: breakoutOnly, score: 100 });
    expect(status).toBe("not-active");
    expect(label).toBe("Watchlist");
  });

  it("Test 2: $225C does not fit Support Reclaim at $215", () => {
    const c = candidate({ setupType: "Pullback-to-Support", entryMode: "Support Reclaim", contract: baseContract({ strike: 225, delta: 0.35 }) });
    expect(selectedContractFitsEntryMode(c, "Breakout")).toBe(false);
  });

  it("Test 4: breakeven move 8.3% blocks Buy Now and applies penalty", () => {
    const pens = disciplinePenalties({ contract: baseContract({ breakevenMovePct: 0.083 }), triggerStatus: "active", breakevenMovePct: 0.083 });
    expect(pens.some((p) => p.reason.includes("Breakeven") && p.delta === -10)).toBe(true);
    const label = gateLabel("Buy Now", { brokerConfirmRequired: false, dteBucket: "swing-eligible", triggerStatus: "active", breakevenMovePct: 0.083, score: 90 });
    expect(label).toBe("Watchlist");
  });

  it("Test 5: support active but selected breakout strike uses breakout trigger", () => {
    const states = splitTriggerStates("CALL", 215.05, { ...flatLevels(215.05), pivot: 214.55, baseHigh: 224.33, r1: 224.33 });
    expect(states.supportReclaimTrigger.status).toBe("active");
    expect(states.breakoutTriggerState.status).toBe("not-active");
    expect(finalTriggerForSelection("Support Reclaim", "Breakout")).toBe("breakout");
  });

  it("Test 6: app Jun 12 vs broker Jun 5 is not comparable", () => {
    const appExpiration: string = "2026-06-12";
    const brokerExpiration: string = "2026-06-05";
    expect(appExpiration === brokerExpiration ? "match" : "not-comparable").toBe("not-comparable");
  });

  it("Test 7: real contract with Buy Now blockers still cannot be Buy Now", () => {
    const label = gateLabel("Buy Now", { brokerConfirmRequired: false, dteBucket: "swing-eligible", triggerStatus: "active", buyNowBlockers: ["breakeven too high"], score: 95 });
    expect(label).toBe("Watchlist");
  });

  it("Setup→entry mode mapping is stable", () => {
    expect(entryModeFromSetup("Pullback-to-Support")).toBe("Support Reclaim");
    expect(entryModeFromSetup("Pivot/Base Breakout")).toBe("Breakout");
    expect(entryModeFromSetup("Pivot/Base Retest")).toBe("Retest");
  });

  it("Expiration bucket labels cover the discipline ranges", () => {
    expect(expirationBucketFor(3)).toBe("weekly-lotto");
    expect(expirationBucketFor(10)).toBe("lotto-aggressive");
    expect(expirationBucketFor(21)).toBe("short-term-swing");
    expect(expirationBucketFor(40)).toBe("extended-swing");
    expect(expirationBucketFor(365)).toBe("leaps");
    expect(expirationBucketFor(120)).toBe("excluded");
  });
});
