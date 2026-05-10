# From Scanner UI → AI Market Assistant

This is a large, multi-area upgrade. To keep quality high and avoid regressions, I'll ship it in **5 ordered phases**, each independently usable. Confirm the plan (or tell me which phases to drop / reorder) and I'll start with Phase 1.

I will **not** redesign the app. Current dark premium look, layout, and routes stay. All changes are additive or replace specific weak spots.

---

## Phase 1 — Truthful status & graceful unavailable states (foundation)

Goal: every "LIVE / Unavailable / —" the user sees reflects reality.

- Extend `TrustEnvelope` status vocabulary to include `connecting` and `refreshing` (in addition to live / delayed / stale / unavailable / error). `rollupStatus` updated accordingly.
- New `<StatusPill />` component (replaces ad-hoc LIVE / Delayed badges in header, RegimeBar, RefreshBar, ScanBar, trade cards, sidebar). Single source of truth, with:
  - color + dot animation per state
  - human-readable label ("Live", "Delayed 2m", "Connecting…", "Refreshing…", "Stale 14m", "Unavailable")
  - tooltip with provider + last successful fetch
- `<TrustValue>` upgraded: instead of `—`, render contextual copy:
  - quotes missing → "Waiting for quote provider"
  - chain missing → "Option chain temporarily unavailable"
  - regime missing → "Market regime temporarily unavailable"
  - rate-limited → "Rate limited — retrying shortly"
  - error → "Reconnecting…"
  - All variants get a subtle shimmer (existing `animate-pulse-dot`) so they feel alive, not dead.
- Page-level "LIVE" header lights:
  - Lit only when `rollupStatus === "live"` across quotes **and** the dashboard's primary data source is non-stale.
  - Otherwise show the actual state, never a green dot over "never".
- "Last successful refresh Xm ago" line added to RefreshBar.

Result: no more "LIVE" while Market Data = never.

---

## Phase 2 — Actionable trade insight on cards

Goal: every card answers "What's the opportunity?" at a glance.

Extend the existing pick payload (already produced by `scoringEngine` + AI) with these surfaced fields on `TradeCard` / `CompactTradeCard` / detail drawer:

- **Expected Move** (e.g. `+4% to +7%`) — derived from ATR × horizon + IV.
- **Continuation Probability** (`72%`) — already partially in scoring; expose it.
- **Ideal Hold** (`2–5 days`) — from entry mode + setup type.
- **Risk / Reward** (`2.4R`) — target vs stop already computed.
- **AI Outlook** one-liner (`Bullish continuation, semis leadership`) — generated server-side.
- **Market Alignment** chip (`Aligned with regime` / `Counter-trend`).
- **Setup Quality** sub-score chip (already exists, surfaced more clearly).

All fields are **TrustValue-gated** — if missing, show "AI still evaluating" rather than `—`.

---

## Phase 3 — Real AI commentary layer (Lovable AI Gateway)

Goal: the app feels like an analyst, not a screener.

- New edge function `ai-commentary` calling Lovable AI Gateway (default `google/gemini-3-flash-preview`). Input: index quotes, regime, sector strength, top picks, breadth, time-of-day. Output: structured JSON with:
  - `headline` (one sentence)
  - `insights[]` (3–6 short bullets)
  - `nextDayOutlook` (paragraph, used after-hours)
  - `risks[]`
- Cached for ~5 min server-side; falls back to deterministic `aiCommentary.ts` if gateway 429/402.
- Surfaced in:
  - Sidebar AI Insight box (replaces hard-coded rotation)
  - New `<AiSummaryCard />` at top of dashboard
  - Regime section ("AI Read")
  - Live opportunities page header
  - Next-day picks header
  - Watchlist header (commentary scoped to held names)
- Refreshes every 5 min during market, hourly after close.

---

## Phase 4 — Market intelligence panels & next-day mode

Goal: kill dead space; make off-hours useful.

New compact panels on the dashboard (and `/live` where relevant), each TrustEnvelope-backed:

- **Strongest / Weakest sectors** (uses existing sector-strength logic, ranked)
- **Top momentum names** (from scanner pipeline)
- **Unusual flow summary** (from options chain provenance — count of high-volume contracts)
- **Market breadth** (advancers/decliners proxy from watchlist universe)
- **Volatility regime** (IV percentile rollup)
- **Upcoming catalysts / Earnings tomorrow** (existing `useEarnings`)
- **AI conviction heatmap** (mini grid colored by AI score)

**Next-day mode**: when `isMarketOpen() === false`, the dashboard re-orders to:
1. AI overnight outlook
2. Best next-day setups
3. Continuation candidates
4. Earnings tomorrow
5. Risk conditions

Intraday/scalp UI is de-emphasized (collapsed accordion) off-hours.

---

## Phase 5 — Watchlist evolution & smart empty states

Goal: watchlist becomes a tracker; empty states feel intelligent.

Watchlist additions per row:
- Δ since saved (price + %)
- AI confidence change (↑/↓ vs save-time)
- Momentum trend chip ("Upgraded", "Weakening", "Holding")
- Target progress bar (% toward target)
- Expiration countdown (for option picks)
- Alert chips: "Approaching target", "Losing continuation strength", "Unusual activity"

Smart empty states (replace all blank sections):
- High-conviction list empty → "No high-conviction setups currently detected. AI is favoring patience."
- Live opps empty → "No unusual flow detected right now."
- Momentum scanner empty → "Momentum conditions weak across major sectors."
- Watchlist empty → existing CTA, unchanged.

---

## Technical notes

- **No DB schema changes** required for Phase 1–2. Phase 3 adds an edge function only. Phase 4 reuses existing services. Phase 5 stores watchlist save-time snapshot in the existing `watchlistService` localStorage row (small additive field).
- **No breaking changes** to existing components — new fields are optional, gated by TrustValue.
- AI commentary uses **Lovable AI** with the deterministic `aiCommentary.ts` as automatic fallback, so the app keeps working at 0 cost / on rate-limit.
- Each phase ends with a typecheck pass.

---

## Suggested order

I recommend shipping **Phase 1 first** — it fixes the "LIVE while Market Data = never" trust bug you flagged, which is blocking the premium feel of everything else. Then 2 → 3 → 4 → 5.

Reply **"start phase 1"** (or pick a different starting point / cut phases) and I'll implement.
