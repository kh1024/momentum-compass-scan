# Contract Quality Scoring — Plan

Goal: Greeks, IV, spread, OI, and volume become a required scoring category and a hard gate. A great chart cannot rescue a bad contract; a great contract cannot rescue an inactive trigger; a real contract is never auto–Buy Now.

## 1. New module: `src/lib/contractQuality.ts`

Pure function `scoreContractQuality(contract, { isLeaps, isYolo })` returns:

```
{
  score: number,           // 0–35
  parts: { delta, theta, iv, spread, oi, volume }, // sub-points
  blockers: string[],      // e.g. "Spread 18% > 15%"
  downgrades: string[],    // soft warnings
  tier: "buyNowEligible" | "watchlistOnly" | "yoloOnly" | "avoid"
}
```

Point bands (exactly as specified):

- Delta /8: 0.35–0.50 → 8; 0.25–0.34 or 0.51–0.60 → 5; 0.15–0.24 → 2 (yoloOnly); <0.15 → 0 (yoloOnly); >0.75 → 2 unless LEAPS.
- Theta burn % /day /7: <3% → 7; 3–5% → 5; 5–8% → 3; >8% → 0 + Buy Now blocker; >10% → yoloOnly.
- IV /6: <45% → 6; 45–60% → 5; 60–70% → 3; 70–85% → 1; >85% → 0 + yoloOnly.
- Spread /6: <5% → 6; 5–10% → 5; 10–15% → 3; >15% → 0 + Buy Now blocker; >20% → avoid tier.
- OI /4: 1000+ → 4; 500–999 → 3; 300–499 → 1 + downgrade; <300 → 0 + avoid tier.
- Volume /4: 1000+ → 4; 250–999 → 3; 100–249 → 2; <100 → 0 + avoid tier.

Hard blockers (set tier to `avoid` for missing data, otherwise to `watchlistOnly` or `yoloOnly`): missing delta/theta/iv/bid/ask/oi/volume; spread>15%; spread>20% (avoid); delta<0.25 non-yolo (watchlistOnly); theta>8% (watchlistOnly); OI<300 (avoid); volume<100 (avoid).

LEAPS exception: delta 0.60–0.80 ideal; OI 300+ acceptable; theta gate relaxed.

## 2. Wire into scoring engine (`src/lib/scoringEngine.ts`)

- Replace the existing inline `scoreOptionQuality` body with a thin wrapper that calls `scoreContractQuality` and returns just the numeric score (keeps callers compiling).
- Export new helper `evaluateContractQuality` returning the full object.
- `disciplinePenalties` adds entries from `contractQuality.blockers` (each -15) so they show in the existing penalty list.
- `assignLabel` accepts a new `contractTier` field on `OverrideContext`:
  - `tier === "avoid"` → force `Avoid`
  - `tier === "watchlistOnly"` → cap at `Watchlist`
  - `tier === "yoloOnly"` → cap at `Lotto`
  - Real contract alone never promotes; existing trigger/above200 gates still apply.

## 3. Candidate type + finalize path (`src/lib/types.ts`, `src/lib/applyLiveQuote.ts`)

Add to `TradeCandidate`:
```
setupScore, contractQualityScore, triggerScore, riskRewardScore,
dataQualityScore, validationPenalty, finalTradableScore,
contractQualityParts, contractBlockers
```
`finalizeCandidate` in `applyLiveQuote.ts` computes all five sub-scores, sums them, applies penalties, then calls `assignLabel` with `contractTier`.

## 4. UI (`src/components/TradeCard.tsx`)

Add a Contract Quality block showing:
- Score `xx / 35` with the six sub-scores (Δ 8/8, Θ 5/7, IV 6/6, Spread 3/6, OI 4/4, Vol 3/4).
- Red chip per blocker, amber per downgrade.
- Six-line score panel: Setup / Contract Quality / Trigger / Risk-Reward / Data Quality / Final Tradable.

No new routes, no design-token changes.

## 5. Tests (`src/lib/__tests__/contractQuality.test.ts`)

10 cases: ideal swing call full marks; delta 0.20 non-yolo → watchlistOnly; theta 9% → blocker + watchlistOnly; spread 18% → blocker; spread 22% → avoid; OI 250 → avoid; volume 80 → avoid; missing IV → avoid; LEAPS delta 0.7 → full delta points; YOLO delta 0.18 → tier yoloOnly with partial credit.

Plus 2 integration cases in `scannerRules.test.ts`: bad-contract candidate cannot be Buy Now even with score 95; great-contract candidate with inactive trigger stays Watchlist.

## Out of scope

- No new routes, no broker-comparison panel, no provenance drawer.
- No mock-data toggle changes.
- No edge function or schema changes.

## Order of work

1. `contractQuality.ts` + tests green.
2. Wire into `scoringEngine` + `applyLiveQuote` + types.
3. TradeCard UI block.
4. Integration tests green.
