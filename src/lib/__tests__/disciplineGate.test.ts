import { describe, it, expect } from "vitest";
import { runDisciplineGate } from "../disciplineGate";
import type { TradeCandidate, OptionContract } from "../types";

function mkContract(over: Partial<OptionContract> = {}): OptionContract {
  return {
    expiration: "2026-06-12",
    strike: 225,
    ask: 7.9,
    bid: 7.7,
    cost: 790,
    iv: 0.4,
    delta: 0.42,
    theta: -0.12,
    thetaBurnPct: 0.015,
    gamma: 0.04,
    vega: 0.12,
    volume: 1500,
    openInterest: 5000,
    spreadPct: 0.025,
    dte: 33,
    breakeven: 232.9,
    breakevenMovePct: 0.04,
    source: "chain",
    brokerConfirmRequired: false,
    missingFields: [],
    priceBasis: "ask",
    costValidationStatus: "valid ask cost",
    ...over,
  };
}

function mkCandidate(over: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
    id: "NVDA-CALL-225-33",
    ticker: "NVDA",
    direction: "CALL",
    price: 215,
    cap: "Mega",
    setupType: "Pivot/Base Breakout",
    score: 88,
    finalScore: 88,
    label: "Buy Now",
    originalLabel: "Buy Now",
    trend: "",
    sectorConfirmation: "",
    redditSentiment: "None",
    levels: { s1: 200, s2: 195, s3: 190, r1: 220, r2: 225, r3: 230, pivot: 214.55, baseHigh: 224.33, baseMid: 219, baseLow: 214, dma20: 210, dma50: 205, dma200: 180 },
    entryTrigger: "",
    invalidation: "",
    target1: 225,
    target2: 235,
    contract: mkContract(),
    entryStrategy: "",
    exitStrategy: "",
    profitPlan: "",
    sizing: "",
    keyRisks: [],
    triggerStatus: "active",
    selectedContractFitsEntryMode: true,
    contractTier: "buyNowEligible",
    contractQualityScore: 32,
    setupScore: 88,
    brokerConfirmRequired: false,
    isDemo: false,
    ...over,
  };
}

describe("runDisciplineGate", () => {
  it("Test 1: mock-seed cannot be Buy Now", () => {
    const c = mkCandidate({
      contract: mkContract({ source: "mock-seed", brokerConfirmRequired: true, missingFields: ["chain-not-loaded"] }),
    });
    const r = runDisciplineGate(c, { extendedSwingEnabled: true });
    expect(r.buyNowEligible).toBe(false);
    expect(r.finalLabel).not.toBe("Buy Now");
    expect(r.displayLabel).not.toBe("Buy Now");
  });

  it("Test 2: chain DTE 33 with Extended Swing enabled routes to extended-swing visible", () => {
    const r = runDisciplineGate(mkCandidate(), { extendedSwingEnabled: true });
    expect(r.bucket).toBe("extended-swing");
    expect(r.routedSection).toBe("extended-swing");
    expect(r.visible).toBe(true);
  });

  it("Test 3: trigger not active blocks Buy Now", () => {
    const c = mkCandidate({ triggerStatus: "not-active" });
    const r = runDisciplineGate(c, { extendedSwingEnabled: true });
    expect(r.buyNowEligible).toBe(false);
    expect(r.displayLabel).not.toBe("Buy Now");
  });

  it("Test 4: blockers present → cannot be Buy Now", () => {
    const c = mkCandidate({ contract: mkContract({ spreadPct: 0.25 }) });
    const r = runDisciplineGate(c, { extendedSwingEnabled: true });
    expect(r.displayLabel).not.toBe("Buy Now");
    expect(r.buyNowBlockers.length).toBeGreaterThan(0);
  });

  it("Test 5: Avoid → no Buy Now anywhere", () => {
    const c = mkCandidate({
      contract: mkContract({ dte: 100 }), // excluded-short-term
    });
    const r = runDisciplineGate(c, { extendedSwingEnabled: true });
    expect(r.displayLabel).toBe("Avoid Ticker");
    expect(r.buyNowEligible).toBe(false);
  });

  it("Test 6: Buy Now displayed → eligibility true and no blockers", () => {
    const c = mkCandidate({ contract: mkContract({ dte: 21 }) });
    const r = runDisciplineGate(c, { extendedSwingEnabled: true });
    if (r.displayLabel === "Buy Now") {
      expect(r.buyNowEligible).toBe(true);
      expect(r.buyNowBlockers).toEqual([]);
    }
  });

  it("Test 7: no 'no explicit downgrade' reason — invariant 10 must pass", () => {
    const c = mkCandidate({ contract: mkContract({ spreadPct: 0.25 }) });
    const r = runDisciplineGate(c, { extendedSwingEnabled: true });
    expect(r.reasons.join(" ")).not.toMatch(/no explicit downgrade/i);
    const inv10 = r.invariants.find((i) => i.id === 10);
    expect(inv10?.pass).toBe(true);
  });

  it("Extended Swing disabled → DTE 33 hidden + Avoid", () => {
    const r = runDisciplineGate(mkCandidate(), { extendedSwingEnabled: false });
    expect(r.visible).toBe(false);
    expect(r.finalLabel).toBe("Avoid Ticker");
  });
});
