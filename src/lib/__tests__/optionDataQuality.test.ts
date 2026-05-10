import { describe, it, expect } from "vitest";
import {
  validateOptionContract,
  findNearbyCompleteStrike,
  type OptionContractData,
} from "../optionDataQuality";

const baseGood: OptionContractData = {
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
  underlyingPrice: 198.5,
};

describe("validateOptionContract", () => {
  it("Test 1 — missing IV: brokerConfirmationRequired, no Buy Now; if still missing after repair, avoid-data-incomplete", () => {
    const noIV = { ...baseGood, impliedVolatility: null };
    const before = validateOptionContract(noIV);
    expect(before.isValidForBuyNow).toBe(false);
    expect(before.brokerConfirmationRequired).toBe(true);
    expect(before.finalDataStatus).toBe("broker-confirmation-required");

    const afterFailedRepair = validateOptionContract(noIV, {
      repairAttempted: true,
      repairSucceeded: false,
      repairEndpoint: "contract-snapshot",
    });
    expect(["broker-confirmation-required", "avoid-data-incomplete"]).toContain(
      afterFailedRepair.finalDataStatus,
    );
    expect(afterFailedRepair.isValidForBuyNow).toBe(false);
  });

  it("Test 2 — missing bid/ask but has Greeks: no Buy Now; quotes-endpoint repair restores", () => {
    const noQuote = { ...baseGood, bid: null, ask: null };
    const before = validateOptionContract(noQuote);
    expect(before.isValidForBuyNow).toBe(false);
    expect(before.verified.quote).toBe(false);
    expect(before.verified.greeks).toBe(true);

    const repaired = { ...noQuote, bid: 5.1, ask: 5.3 };
    const after = validateOptionContract(repaired, {
      repairAttempted: true,
      repairSucceeded: true,
      repairEndpoint: "quotes",
    });
    expect(after.isValidForBuyNow).toBe(true);
    expect(after.finalDataStatus).toBe("repaired");
  });

  it("Test 3 — missing Greeks: no clean Watchlist; final status BCR or avoid-data-incomplete", () => {
    const noGreeks = { ...baseGood, delta: null, gamma: null, theta: null, vega: null };
    const r = validateOptionContract(noGreeks, {
      repairAttempted: true,
      repairSucceeded: false,
      repairEndpoint: "contract-snapshot",
    });
    expect(r.isValidForWatchlist).toBe(false);
    expect(r.isValidForBuyNow).toBe(false);
    expect(["broker-confirmation-required", "avoid-data-incomplete"]).toContain(r.finalDataStatus);
  });

  it("Test 4 — original incomplete but a nearby strike has complete data → recommendedReplacement set", () => {
    const broken: OptionContractData = { ...baseGood, bid: null, ask: null, delta: null };
    const goodNearby: OptionContractData = {
      ...baseGood,
      optionTicker: "O:NVDA260619C00205000",
      strikePrice: 205,
    };
    const otherFar: OptionContractData = {
      ...baseGood,
      optionTicker: "O:NVDA260619C00250000",
      strikePrice: 250,
      volume: 5,
    };
    const replacement = findNearbyCompleteStrike(broken, [goodNearby, otherFar]);
    expect(replacement?.optionTicker).toBe(goodNearby.optionTicker);

    const r = validateOptionContract(broken, { nearbyComplete: replacement });
    expect(r.recommendedReplacement?.optionTicker).toBe(goodNearby.optionTicker);
    expect(r.replacementReason).toMatch(/Original contract rejected/);
  });

  it("Test 5 — fully verified contract passes data-quality (other gates still apply)", () => {
    const r = validateOptionContract(baseGood);
    expect(r.isValidForBuyNow).toBe(true);
    expect(r.finalDataStatus).toBe("verified");
    expect(r.verified.quote && r.verified.greeks && r.verified.iv && r.verified.volumeOI).toBe(true);
    expect(r.missingFields).toEqual([]);
  });
});
