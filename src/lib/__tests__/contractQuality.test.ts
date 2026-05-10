import { describe, it, expect } from "vitest";
import { scoreContractQuality } from "../contractQuality";
import type { OptionContract } from "../types";

const base = (over: Partial<OptionContract> = {}): OptionContract => ({
  expiration: "2026-06-12",
  strike: 220,
  ask: 7.5,
  bid: 7.4,
  cost: 750,
  iv: 0.4,
  delta: 0.42,
  theta: -0.15,
  thetaBurnPct: 0.02,
  gamma: 0.01,
  vega: 0.1,
  volume: 2000,
  openInterest: 5000,
  spreadPct: 0.02,
  dte: 21,
  breakeven: 227.5,
  breakevenMovePct: 0.04,
  ...over,
});

describe("scoreContractQuality", () => {
  it("ideal swing call earns full marks", () => {
    const r = scoreContractQuality(base());
    expect(r.score).toBe(35);
    expect(r.tier).toBe("buyNowEligible");
    expect(r.blockers).toHaveLength(0);
  });

  it("delta 0.20 non-yolo → yoloOnly with blocker", () => {
    const r = scoreContractQuality(base({ delta: 0.2 }));
    expect(r.tier).toBe("yoloOnly");
    expect(r.blockers.some((b) => b.includes("Delta"))).toBe(true);
  });

  it("theta 9% → blocker, watchlistOnly", () => {
    const r = scoreContractQuality(base({ thetaBurnPct: 0.09 }));
    expect(r.parts.theta).toBe(0);
    expect(r.tier).toBe("watchlistOnly");
    expect(r.blockers.some((b) => b.includes("Theta"))).toBe(true);
  });

  it("spread 18% → blocker, watchlistOnly", () => {
    const r = scoreContractQuality(base({ spreadPct: 0.18 }));
    expect(r.tier).toBe("watchlistOnly");
    expect(r.blockers.some((b) => b.includes("Spread"))).toBe(true);
  });

  it("spread 22% → avoid", () => {
    const r = scoreContractQuality(base({ spreadPct: 0.22 }));
    expect(r.tier).toBe("avoid");
  });

  it("OI 250 → avoid", () => {
    const r = scoreContractQuality(base({ openInterest: 250 }));
    expect(r.tier).toBe("avoid");
  });

  it("volume 80 → avoid", () => {
    const r = scoreContractQuality(base({ volume: 80 }));
    expect(r.tier).toBe("avoid");
  });

  it("missing IV → avoid", () => {
    const r = scoreContractQuality(base({ iv: 0 }));
    expect(r.tier).toBe("avoid");
  });

  it("LEAPS delta 0.7 → full delta points", () => {
    const r = scoreContractQuality(base({ delta: 0.7, dte: 365 }), { isLeaps: true });
    expect(r.parts.delta).toBe(8);
  });

  it("YOLO delta 0.18 still tracks as yoloOnly", () => {
    const r = scoreContractQuality(base({ delta: 0.18 }), { isYolo: true });
    expect(r.tier).toBe("yoloOnly");
  });
});
