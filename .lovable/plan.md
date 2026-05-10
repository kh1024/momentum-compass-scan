# Plan — Better Scanner, Same Buy Now Discipline

Goal: surface more useful daily candidates without softening Buy Now rules. Restructure labels and add a contract-repair pass so a weak strike doesn't kill a strong ticker.

## 1. Universe groups (data + UI)

- Add `src/lib/universe.ts` exporting four groups with the requested tickers:
  `MEGA_LARGE`, `ETFS`, `MID_MOMENTUM`, `YOLO_REDDIT`.
- Add `getActiveUniverse()` that combines enabled groups (defaults: all 4 on).
- Persist per-group toggles in `localStorage` (`scanner.universe.<group>`).
- Replace mock-driven candidate generation in `mockData.ts`/scanner with: build candidates from the active universe (still using mock OHLC/setup heuristics for now since we don't have full historical scan logic). Each ticker gets a synthesized candidate per its setup-type heuristic so the scanner has more rows to triage.
- Universe toggles render as a chip group in the Scanner filter bar.

## 2. New tiers + label set

Extend `Label` in `src/lib/types.ts`:

```text
"Buy Now" | "Watchlist" | "Waiting on Trigger" | "Aggressive" |
"Lotto" | "Near Miss" | "Find Better Strike" |
"Avoid Contract" | "Avoid Ticker"
```

Map old `"Avoid"` → either `"Avoid Contract"` (chart OK, contract fails after repair) or `"Avoid Ticker"` (chart fails). Keep `"Avoid"` as a legacy alias internally for back-compat in `disciplineGate.ts` callers.

## 3. Contract auto-repair (`Find Better Contract`)

New module `src/lib/contractAutoRepair.ts`:

- Input: ticker, direction, original chain pick, full chain (when available), failure reasons.
- If failures match {strike-fit, OI low, volume low, spread wide, breakeven far, missing IV/greeks/quote}, search:
  1. Same expiration: 3 strikes below / 5 above.
  2. ATM / near-trigger strikes.
  3. Next expiration in same DTE bucket.
- Score candidates by liquidity + delta-fit + spread; pick best that passes thresholds.
- Hook into `chain.functions.ts` enrichment: when initial pick fails quality gate, run repair before returning. The repair output adds `repaired: true` and `repairReason`.
- If repair finds a contract → label `Watchlist` (or `Aggressive` if liquidity is on the warning band).
- If repair fails → label `Find Better Strike` (chart still good) — never `Avoid Ticker`.

## 4. Waiting on Trigger

In `disciplineGate.ts`, when contract passes quality but `triggerStatus !== "active"`:
- Route to new bucket `waitingOnTrigger`.
- Display label `Waiting on Trigger`.
- Surface trigger level + suggested contract on the card.
- Excluded from Buy Now regardless.

## 5. Scanner mode (Strict / Balanced / Discovery)

Add `scannerMode` setting (UI toggle, persisted in localStorage; default `Balanced`). Wire into the gate's threshold pack:

- Strict: current hard rules, no warning bands.
- Balanced (default): Buy Now still strict; OI 100–299 → "thin liquidity" warning + Watchlist; volume 50–99 → low-volume warning + Watchlist; spread 15–20% caps at Aggressive.
- Discovery: include YOLO/Reddit setups, allow Lotto/Aggressive on lower-liquidity contracts, but Buy Now hard rules unchanged.

Implement as a `ModePack` consumed by `disciplineGate`.

## 6. DTE buckets

Update `expirationBucketFor` and `expirationDates.ts`:

```text
weeklyLotto    : 0–6
weekly         : 7–13
shortSwing     : 14–30
extendedSwing  : 31–45
swingPlus      : 46–60   ← NEW
leaps          : 180+
```

Render each as a separate section. Update filter pills to include `46–60`.

## 7. Filters

Replace single "Hide Avoids" with:
- `Hide True Avoids` (default ON) — hides only `Avoid Ticker`. Near Miss / Find Better Strike / Avoid Contract still visible.
- Per-tier visibility chips: Buy Now / Watchlist / Waiting on Trigger / Aggressive / Near Miss / Find Better Strike / Avoid Contract.

## 8. Top-bar counts

Add aggregate stats: Buy Now, Watchlist, Waiting on Trigger, Aggressive, Near Miss, Avoid Contract, Avoid Ticker, **Total scanned**, **Passed chart setup**, **Failed contract quality**. Also add the universe-active indicator (`4/4 groups · 58 tickers`).

## 9. Files touched

- `src/lib/types.ts` — extend `Label`.
- `src/lib/universe.ts` — new.
- `src/lib/contractAutoRepair.ts` — new.
- `src/lib/scannerMode.ts` — new.
- `src/lib/disciplineGate.ts` — new buckets, new labels, mode-pack thresholds, trigger routing.
- `src/lib/optionQualityValidator.ts` / `expirationDates.ts` — Swing+ bucket.
- `src/lib/chain.functions.ts` — call repair on failure.
- `src/lib/mockData.ts` — synthesize candidates from universe groups.
- `src/routes/scanner.tsx` — universe chips, mode toggle, new filters, new counts, sections per DTE bucket.
- `src/routes/index.tsx` — new label colors + counts.
- `src/components/Badges.tsx` — chip styles for new labels.

## 10. Out of scope (this pass)

- True scanning over historical OHLC (still uses mocked setups; Massive provides quotes/chains).
- Persisting mode/universe to backend (localStorage only).

## 11. Verification

After build, manually open Scanner with each mode, confirm:
- Total scanned ≥ active universe size.
- Buy Now count unchanged in Strict (vs current Buy Now logic on existing tickers).
- Near Miss appears with repair suggestions.
- Waiting on Trigger lists trigger levels.
- Hide True Avoids hides only `Avoid Ticker`.

This is a multi-pass refactor, so I'll commit it as one cohesive change. Approve to proceed.