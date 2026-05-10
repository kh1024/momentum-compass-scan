import { describe, it, expect } from "vitest";
import { selectContractFromChain, type PublicOptionChain, type PublicOptionContract } from "../publicCom.server";
import { buildExpirationMeta } from "../expirationMeta";

const mk = (over: Partial<PublicOptionContract>): PublicOptionContract => ({
  symbol: "NVDA", occSymbol: "NVDA-X", type: "CALL",
  strike: 220, expiration: "2026-06-12", dte: 33,
  bid: 7.4, ask: 7.5, mid: 7.45, spreadPct: 0.013,
  iv: 0.4, delta: 0.4, gamma: 0.01, theta: -0.15, vega: 0.1,
  volume: 2000, openInterest: 5000, breakeven: 227.45, expectedMovePct: 0.12,
  ...over,
});

const chain = (contracts: PublicOptionContract[]): PublicOptionChain => ({
  symbol: "NVDA", underlyingPrice: 215, expectedMovePct: 0.1, contracts,
});

describe("selectContractFromChain — expiration filter", () => {
  const c0605 = mk({ expiration: "2026-06-05", dte: 26, strike: 217.5, delta: 0.45 });
  const c0612 = mk({ expiration: "2026-06-12", dte: 33, strike: 220, delta: 0.4 });

  it("Test 1: selectedExpiration=06-05 → picks 06-05 even when 06-12 also available", () => {
    const r = selectContractFromChain(chain([c0605, c0612]), { direction: "CALL", selectedExpiration: "2026-06-05" });
    expect(r.contract?.expiration).toBe("2026-06-05");
    expect(r.reason).toBe("user-filter");
    expect(r.selectionFilterApplied).toBe(true);
  });

  it("Test 2: selectedExpiration mismatch must NOT silently fall back to 06-12", () => {
    const r = selectContractFromChain(chain([c0605, c0612]), { direction: "CALL", selectedExpiration: "2026-06-05" });
    // Hard rule — failing expiration would mean scanner ignored the filter.
    expect(r.contract?.expiration).not.toBe("2026-06-12");
  });

  it("Test 3: no selectedExpiration with extended swing → may pick DTE 33 by score", () => {
    const r = selectContractFromChain(chain([c0605, c0612]), { direction: "CALL" });
    expect(r.reason).toBe("best-score");
    expect(r.selectionFilterApplied).toBe(false);
    expect(["2026-06-05", "2026-06-12"]).toContain(r.contract?.expiration);
  });

  it("Test 4: selectedExpiration with no matching contracts → null + reason user-filter + trace", () => {
    const r = selectContractFromChain(chain([c0612]), { direction: "CALL", selectedExpiration: "2026-06-05" });
    expect(r.contract).toBeNull();
    expect(r.reason).toBe("user-filter");
    expect(r.selectionFilterApplied).toBe(true);
    expect(r.trace.length).toBeGreaterThan(0);
    expect(r.trace[0].failReason).toMatch(/expiration .* ≠ selected 2026-06-05/);
  });

  it("Test 5: buildExpirationMeta sorts by Date object, not alphabetical", () => {
    const meta = buildExpirationMeta([
      { expiration: "2026-06-12", dte: 33, type: "CALL" },
      { expiration: "2026-06-05", dte: 26, type: "CALL" },
      { expiration: "2026-06-05", dte: 26, type: "PUT" },
    ]);
    expect(meta.map((m) => m.expiration)).toEqual(["2026-06-05", "2026-06-12"]);
    expect(meta[0].callCount).toBe(1);
    expect(meta[0].putCount).toBe(1);
    expect(meta[1].bucket).toBe("extended-swing");
  });
});
