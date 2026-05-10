import { describe, it, expect } from "vitest";
import {
  validateContract,
  dteBucketFor,
  gateLabel,
} from "../optionQualityValidator";
import { calculateThetaBurn } from "../scoringEngine";
import type { OptionContract } from "../types";

const baseContract = (overrides: Partial<OptionContract> = {}): OptionContract => ({
  expiration: "2026-06-19",
  strike: 220,
  ask: 4.2,
  bid: 4.1,
  cost: 420,
  iv: 0.45,
  delta: 0.45,
  theta: -0.05,
  thetaBurnPct: 0.012,
  gamma: 0.04,
  vega: 0.12,
  volume: 500,
  openInterest: 2000,
  spreadPct: 0.04,
  dte: 21,
  breakeven: 224.2,
  breakevenMovePct: 0.025,
  source: "chain",
  ...overrides,
});

describe("dteBucketFor", () => {
  it("excludes DTE < 7", () => {
    expect(dteBucketFor(5)).toBe("excluded");
  });
  it("buckets 7–13 as lotto-only", () => {
    expect(dteBucketFor(10)).toBe("lotto-only");
  });
  it("buckets 14–30 as swing-eligible", () => {
    expect(dteBucketFor(21)).toBe("swing-eligible");
  });
  it("buckets 40 DTE out of short-term scanner", () => {
    expect(dteBucketFor(40)).toBe("excluded-short-term");
  });
  it("buckets 365 DTE as LEAPS-only", () => {
    expect(dteBucketFor(365)).toBe("leaps-only");
  });
});

describe("validateContract", () => {
  it("accepts a complete chain contract", () => {
    const r = validateContract(baseContract());
    expect(r.ok).toBe(true);
    expect(r.brokerConfirmRequired).toBe(false);
    expect(r.missingFields).toEqual([]);
  });
  it("flags missing greeks as broker-confirm-required", () => {
    const r = validateContract(baseContract({ delta: NaN, theta: NaN }));
    expect(r.brokerConfirmRequired).toBe(true);
    expect(r.missingFields).toContain("delta");
    expect(r.missingFields).toContain("theta");
  });
  it("flags missing bid/ask", () => {
    const r = validateContract(baseContract({ bid: NaN, ask: 0 }));
    expect(r.brokerConfirmRequired).toBe(true);
    expect(r.missingFields).toContain("bid");
    expect(r.missingFields).toContain("ask");
  });
  it("flags spread > 15% as not a disciplined pick", () => {
    const r = validateContract(baseContract({ spreadPct: 0.18 }));
    expect(r.brokerConfirmRequired).toBe(true);
    expect(r.missingFields).toContain("spread>15%");
  });
  it("preserves the real chain strike exactly", () => {
    const c = baseContract({ strike: 217.5 });
    const r = validateContract(c);
    expect(r.ok).toBe(true);
    // Strike must not be mutated by the validator.
    expect(c.strike).toBe(217.5);
  });
});

describe("gateLabel — DTE discipline", () => {
  it("downgrades Buy Now to Avoid on DTE 5", () => {
    expect(
      gateLabel("Buy Now", {
        brokerConfirmRequired: false,
        dteBucket: dteBucketFor(5),
      }),
    ).toBe("Avoid");
  });
  it("downgrades Buy Now to Avoid on DTE 40 (short-term scanner)", () => {
    expect(
      gateLabel("Buy Now", {
        brokerConfirmRequired: false,
        dteBucket: dteBucketFor(40),
        isLeaps: false,
      }),
    ).toBe("Avoid");
  });
  it("caps DTE 7–13 at Lotto", () => {
    expect(
      gateLabel("Buy Now", {
        brokerConfirmRequired: false,
        dteBucket: dteBucketFor(10),
      }),
    ).toBe("Lotto");
  });
  it("allows DTE 21 swing through", () => {
    expect(
      gateLabel("Buy Now", {
        brokerConfirmRequired: false,
        dteBucket: dteBucketFor(21),
      }),
    ).toBe("Buy Now");
  });
});

describe("gateLabel — verification discipline", () => {
  it("never lets an unverified contract be Buy Now", () => {
    expect(
      gateLabel("Buy Now", {
        brokerConfirmRequired: true,
        dteBucket: "swing-eligible",
      }),
    ).toBe("Watchlist");
  });
  it("missing greeks → cannot be Buy Now", () => {
    const v = validateContract(baseContract({ delta: NaN }));
    expect(
      gateLabel("Buy Now", {
        brokerConfirmRequired: v.brokerConfirmRequired,
        dteBucket: v.dteBucket,
      }),
    ).toBe("Watchlist");
  });
  it("missing bid/ask → cannot be Buy Now", () => {
    const v = validateContract(baseContract({ bid: NaN, ask: 0 }));
    expect(
      gateLabel("Buy Now", {
        brokerConfirmRequired: v.brokerConfirmRequired,
        dteBucket: v.dteBucket,
      }),
    ).toBe("Watchlist");
  });
  it("spread > 15% → not a disciplined pick (no Buy Now)", () => {
    const v = validateContract(baseContract({ spreadPct: 0.18 }));
    expect(
      gateLabel("Buy Now", {
        brokerConfirmRequired: v.brokerConfirmRequired,
        dteBucket: v.dteBucket,
      }),
    ).toBe("Watchlist");
  });
});

describe("theta burn formula", () => {
  it("equals |theta| / ask", () => {
    expect(calculateThetaBurn(-0.06, 4.0)).toBeCloseTo(0.015);
    expect(calculateThetaBurn(0.06, 4.0)).toBeCloseTo(0.015);
  });
  it("returns 0 when ask is invalid (broker-confirm path)", () => {
    expect(calculateThetaBurn(-0.06, 0)).toBe(0);
  });
});
