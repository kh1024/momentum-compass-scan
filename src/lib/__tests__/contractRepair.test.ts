import { describe, it, expect } from "vitest";
import { searchBetterContract } from "../contractRepair";
import type { OptionContractData } from "../optionDataQuality";

const goodCall = (over: Partial<OptionContractData> = {}): OptionContractData => ({
  optionTicker: "O:NVDA260619C00200000",
  underlyingTicker: "NVDA",
  expirationDate: "2026-06-19",
  strikePrice: 200,
  contractType: "CALL",
  bid: 5.1,
  ask: 5.3,
  latestTrade: 5.2,
  delta: 0.45,
  gamma: 0.02,
  theta: -0.05,
  vega: 0.12,
  impliedVolatility: 0.42,
  volume: 1500,
  openInterest: 4200,
  spreadPct: 0.04,
  dte: 26,
  breakeven: 205.2,
  underlyingPrice: 200,
  ...over,
});

describe("searchBetterContract — acceptance", () => {
  it("Test 1 — NVDA original OI=195 + strike misfit → repair search finds better strike", () => {
    const original = goodCall({
      optionTicker: "O:NVDA-260619-C-220",
      strikePrice: 220, // doesn't fit Support Reclaim (>3% from ATM 200)
      openInterest: 195, // 100–299 → no Buy Now
    });
    const better = goodCall({
      optionTicker: "O:NVDA-260619-C-202.5",
      strikePrice: 202.5,
      openInterest: 1240,
      volume: 680,
      delta: 0.46,
      spreadPct: 0.06,
    });
    const r = searchBetterContract({
      original,
      chain: [original, better, goodCall({ optionTicker: "X1", strikePrice: 250, openInterest: 50 })],
      ctx: { direction: "CALL", entryMode: "Support Reclaim", underlyingPrice: 200, breakoutTrigger: 0 },
    });
    expect(r.replacementSearchAttempted).toBe(true);
    expect(r.replacementContractFound).toBe(true);
    expect(r.replacementContract?.optionTicker).toBe(better.optionTicker);
    expect(r.finalLabelHint === "Buy Now Eligible" || r.finalLabelHint === "Watchlist / Buy on Trigger").toBe(true);
  });

  it("Test 2 — AVGO contract vol 13/OI 4/spread 100% with no nearby valid strike → No Valid Strike Found", () => {
    const original = goodCall({
      underlyingTicker: "AVGO",
      optionTicker: "O:AVGO-1",
      volume: 13,
      openInterest: 4,
      spreadPct: 1,
    });
    const trash = goodCall({
      underlyingTicker: "AVGO",
      optionTicker: "O:AVGO-2",
      strikePrice: 205,
      volume: 5,
      openInterest: 9,
      spreadPct: 0.9,
    });
    const r = searchBetterContract({
      original,
      chain: [original, trash],
      ctx: { direction: "CALL", entryMode: "Support Reclaim", underlyingPrice: 200, breakoutTrigger: 0 },
    });
    expect(r.replacementContractFound).toBe(false);
    expect(r.finalLabelHint).toBe("Avoid Contract / No Valid Strike Found");
  });

  it("Test 3 — AMD missing Greeks/IV with no verified nearby → Avoid Contract / Data Incomplete", () => {
    const original = goodCall({
      underlyingTicker: "AMD",
      optionTicker: "O:AMD-1",
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      impliedVolatility: null,
    });
    const alsoBroken = goodCall({
      underlyingTicker: "AMD",
      optionTicker: "O:AMD-2",
      strikePrice: 202.5,
      delta: null,
      theta: null,
    });
    const r = searchBetterContract({
      original,
      chain: [original, alsoBroken],
      ctx: { direction: "CALL", entryMode: "Support Reclaim", underlyingPrice: 200, breakoutTrigger: 0 },
    });
    expect(r.replacementContractFound).toBe(false);
    expect(r.finalLabelHint).toBe("Avoid Contract / Data Incomplete");
  });

  it("Test 4 — MSFT contract good but trigger not active → Watchlist / Buy on Trigger (not Avoid)", () => {
    const original = goodCall({ underlyingTicker: "MSFT" });
    const r = searchBetterContract({
      original,
      chain: [original],
      ctx: { direction: "CALL", entryMode: "Support Reclaim", underlyingPrice: 200, breakoutTrigger: 0, triggerActive: false },
    });
    expect(r.finalLabelHint).toBe("Watchlist / Buy on Trigger");
  });

  it("Test 5 — RIVN strike misfit but OI/volume/spread fine → finds better strike, not Avoid Ticker", () => {
    const original = goodCall({
      underlyingTicker: "RIVN",
      optionTicker: "O:RIVN-1",
      strikePrice: 230, // far OTM, doesn't fit Support Reclaim
      delta: 0.18,
    });
    const fit = goodCall({
      underlyingTicker: "RIVN",
      optionTicker: "O:RIVN-2",
      strikePrice: 201,
      delta: 0.45,
    });
    const r = searchBetterContract({
      original,
      chain: [original, fit],
      ctx: { direction: "CALL", entryMode: "Support Reclaim", underlyingPrice: 200, breakoutTrigger: 0, triggerActive: true },
    });
    expect(r.replacementContractFound).toBe(true);
    expect(r.finalLabelHint).toBe("Buy Now Eligible");
  });
});
