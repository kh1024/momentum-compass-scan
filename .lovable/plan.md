# Pivot: AI Momentum & Options Opportunity Scanner

Refactor the existing trading-terminal UI into a clean AI scanner focused on next-day / swing opportunities. **Keep the scanner engine, scoring, validation, and live data layer intact** — only the presentation layer and labeling vocabulary change.

## 1. New vocabulary (global find/replace in UI layer)

Replace all user-facing trigger/validation language with the new vocabulary. Internal field names stay the same.

| Old (UI) | New (UI) |
|---|---|
| Buy Now | High Conviction |
| Watchlist | Near Entry / Forming |
| Aggressive | Aggressive (kept) |
| Lotto | Lottery |
| Near Miss | Watch Closely |
| Find Better Strike | (hidden — quietly filtered) |
| Avoid Contract / Avoid Ticker | (hidden — filtered out) |
| trigger not-active / waiting-retest / stale | Forming / Waiting Pullback / Watch Closely |
| "breakeven move X% — find better strike" | "Extended Move" badge |
| "broker confirmation required" | (hidden) |
| "volume X < 50 — Avoid" | "Low Liquidity" badge |

Files: `src/components/Badges.tsx`, `src/components/Tip.tsx`, `src/components/TradeCard.tsx`, `src/components/CompactTradeCard.tsx`, `src/components/TradeTable.tsx`, `src/components/TradeDetailDrawer.tsx`, `src/lib/disciplineGate.ts` (output mapping only — keep internal logic).

## 2. Dashboard restructure (`src/routes/index.tsx`)

New header: **"Daily AI Picks"** with subtitle "Best options opportunities for the next few days."

Sections (in order):
1. **Best Overall** — top 3 across all setups
2. **High Conviction** — eligible cards
3. **Momentum** — strong RS + volume
4. **Watchlist** — Forming / Near Entry
5. **Aggressive**
6. **Lottery**

Filter pills become: All · High Conviction · Momentum · Watchlist · Aggressive · Lottery.
Remove "Avoid Contract" / "Avoid Ticker" pills and stat cards. Filter Avoids out by default.

Stat cards collapse to: **Total · High Conviction · Momentum · Watchlist · Lottery**.

## 3. New trade card content

Each card shows (no engineering jargon):
- Ticker · CALL/PUT · confidence score (ring)
- One-line AI thesis ("Why AI likes it")
- Expected move %, Hold timeframe (Days/Swing/LEAPS)
- Lightweight badges: `High IV`, `Wide Spread`, `Low Liquidity`, `Extended Move`, `High Risk`, `Momentum Confirmed`, `Waiting Pullback`, `Strong Continuation`, `Watch Closely`
- Strike, expiration, ask, breakeven (compact row)
- "Details →"

Remove from card surface: trigger labels, blocker lists, validation messages, "broker confirmation required", T1/T2 levels (move to drawer), missingFields strings.

## 4. Live Opportunities tab (new route)

New route `src/routes/live.tsx` — secondary tab in nav. Shows only candidates with:
- unusual flow (volume > 3× avg OI)
- rapid score change (delta > 5 in last scan)
- breaking momentum (>2% intraday with volume confirmation)

Empty state: "No exceptional intraday moves right now."

## 5. Trade Detail Drawer refactor (`src/components/TradeDetailDrawer.tsx`)

Top section (always visible):
- AI thesis (bull case / bear case)
- Confidence score + breakdown (4 bars: Momentum, Liquidity, Risk/Reward, Regime alignment)
- Expected move, suggested hold timeframe
- Key risk warnings (1–3 plain-language items)
- Market regime alignment line

Collapse behind **"Developer Mode"** toggle (off by default, persisted in localStorage):
- raw blockers list
- invariant checks
- validation pipeline output
- API source diagnostics
- contract verification fields
- sub-scores breakdown

## 6. Market Regime card

Simplify language to **Risk On / Neutral / Risk Off** with one-sentence AI summary line. Drop "Demo data" footer when live. Keep SPY/QQQ/SMH ticks.

## 7. Quiet validation

`disciplineGate.ts` keeps current logic but the UI layer:
- treats `Avoid Contract` / `Avoid Ticker` / `Find Better Strike` / `Hidden` → filtered out of dashboard entirely (still visible in a Developer Mode "All Candidates" view)
- maps remaining labels to the new vocabulary at render time
- replaces blocker reasons with the lightweight badge set above

No backend / scoring / data-layer changes.

## 8. Hide / deprioritize

- Performance + Patterns routes: keep but de-emphasize in nav (move under "More")
- IO Data, API Health, Scanner debug routes: move under Developer Mode
- Sidebar / NavBar: primary tabs become **Daily Picks · Live · Watchlist · Settings**

## Technical notes

- Add `src/lib/uiVocabulary.ts` exporting `displayLabelFor(finalLabel)` and `badgesFor(candidate)` helpers — single source of truth for new vocabulary mapping. Every card/table imports from here.
- Add `useDeveloperMode()` hook backed by `localStorage("dev-mode")`.
- No database / server-fn / scoring engine changes. Validation logic in `disciplineGate.ts` stays; only its consumers change.
- Tests in `src/lib/__tests__/disciplineGate.test.ts` keep passing — internal labels unchanged.

## Out of scope (this pass)

- New AI thesis generation (use existing `nova.functions.ts` output; if missing, fall back to existing `narrative` / `thesis` fields).
- Real unusual-flow detector (Live tab uses existing volume/OI ratio + score-delta heuristics; deeper detector is a follow-up).
- Visual redesign of color tokens / typography (keep current dark theme).
