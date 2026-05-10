## Goal

Stabilize the foundation. Stop adding surface features. Refactor into a centralized, trust-aware, production-style data architecture before any further UI work. This plan is sequenced in phases and intentionally scoped — each phase ships independently, the app stays runnable between phases, and no fake data ever reaches the UI.

## Current state (why it feels unreliable)

- Quote / chain / sentiment fetches happen directly inside hooks and components (`useLiveQuotes`, `useLiveChain`, `useRedditSentiment`, ad-hoc fetches in routes).
- `mockData.ts` + `applyLiveQuote.ts` overlay live values onto synthetic candidates — when live fails, mock numbers leak through.
- No single source for "where did this number come from / how old is it / did the provider error".
- Three different status calculations (`liveStateTracker`, ad-hoc `dataMode` in scanner, banner logic in `index.tsx`) disagree.
- Picks get generated even when chains are missing — the discipline gate hides some, but synthetic prices still render.
- Watchlist persists fine but reads from the same fragmented hooks, so its P/L can be based on stale or repaired data without saying so.

## Target architecture

```text
                ┌────────────────────────────────────────┐
                │         providers.server.ts            │
                │  Yahoo / Stooq / Finnhub / public chain│
                └──────────────┬─────────────────────────┘
                               │ (server fns only)
        ┌──────────────────────┼──────────────────────────┐
        ▼                      ▼                          ▼
 marketDataService     optionsDataService          sentimentService
 (quotes + regime)     (chains + contracts)        (reddit + earnings)
        │                      │                          │
        └──────────┬───────────┴───────────┬──────────────┘
                   ▼                       ▼
              TrustEnvelope<T>       aiScannerService
              { value, source,       (consumes the three
                fetchedAt, stale,     services; emits ranked
                status, error }       picks ONLY when inputs
                   │                  pass quality gate)
                   ▼                       │
            React Query hooks ◄────────────┘
            (one hook per service, no direct fetches in components)
                   │
                   ▼
          watchlistService (reads same hooks, snapshots TrustEnvelope at add-time)
                   │
                   ▼
              UI layer (TrustBadge, StaleBadge, Unavailable)
```

Every value the UI renders is a `TrustEnvelope<T>`:

```ts
type DataStatus = "live" | "delayed" | "stale" | "unavailable" | "error";
interface TrustEnvelope<T> {
  value: T | null;
  source: "yahoo" | "stooq" | "finnhub" | "public-chain" | "reddit" | "cache" | null;
  fetchedAt: number | null;        // epoch ms
  ageMs: number | null;
  status: DataStatus;
  error?: { code: string; message: string };
  validated: boolean;              // passed schema + sanity checks
}
```

The UI never reads a raw number — it reads an envelope and decides what to render.

## Phase plan

Each phase has a clear exit criterion. We ship after each one.

### Phase 1 — Data foundation refactor

Create `src/services/`:

- `trust.ts` — `TrustEnvelope`, `DataStatus`, `wrap()`, `unavailable()`, `staleAfter()`, helpers.
- `marketDataService.ts` — `getQuotes(symbols)`, `getRegime()`. Wraps existing `quote.functions.ts`. Returns `Record<symbol, TrustEnvelope<Quote>>`. Centralizes retry, dedup, freshness threshold (60s = live, 5m = delayed, >5m = stale).
- `optionsDataService.ts` — `getChain(ticker, picks)` and `getContract(key)`. Wraps `chain.functions.ts` + `contractVerify.server.ts`. Runs liquidity/spread/expiration validators before returning. Invalid contracts return `unavailable("contract-failed-validation")`.
- `sentimentService.ts` — wraps reddit + earnings.
- `aiScannerService.ts` — pure orchestrator: pulls quote envelope + chain envelope + sentiment envelope, runs scoring + discipline gate, emits `RankedPick[]` ONLY when all required envelopes are `live` or `delayed` AND validated. Otherwise returns `{ picks: [], reason: "insufficient-live-data", missing: [...] }`.
- `watchlistService.ts` — read/write API over `localStorage`, but every entry stores the source TrustEnvelope at add-time and exposes computed `currentEnvelope` from `marketDataService`/`optionsDataService`.

Hooks become thin: `useMarketQuotes`, `useOptionChain`, `useScannerPicks`, `useWatchlist` — each one wraps a service through React Query. Components import only hooks. No `fetch` / no provider names in components.

Exit: every component that previously called `useLiveQuotes`/`useLiveChain`/`useRedditSentiment` directly now calls a service-backed hook returning envelopes. `rg "useLiveQuotes\|useLiveChain\|useRedditSentiment" src/routes src/components` returns nothing.

### Phase 2 — Remove all fake data from UI paths

- `mockData.ts` becomes `universeSeed.ts`: returns ticker/direction/setup metadata only — never prices, never option contracts, never IV/delta. Anything price-shaped is removed from the seed.
- `applyLiveQuote.ts`: deleted. Its only legitimate job (overlay live onto mock) goes away because picks are now built from live envelopes upward.
- Any `Math.random`, hardcoded SPY/QQQ values, synthetic regime, fake confidence delta, generated chains: deleted. `rg "Math.random|MOCK_|fake|demo" src/{lib,components,routes,hooks,services}` must come back empty (or only in tests).
- Components that used to render a number now render `<TrustValue envelope={...} />` which shows the value, the unavailable state, or the error — never a fallback number.

Exit: turning off the network shows clean "unavailable" states everywhere; no number is rendered.

### Phase 3 — Trust layer (UI)

New components in `src/components/trust/`:

- `TrustBadge` — pill: Live / Delayed / Stale / Unavailable / Error, color-coded, with tooltip showing source + age.
- `LastUpdated` — "Updated 12s ago", auto-ticking but cheap (single global 30s interval, not per-card).
- `ProviderStatusStrip` — top-of-page strip showing per-service envelope rollup (quotes / chain / sentiment).
- `Unavailable` — empty state used wherever a value can't be shown.

`liveStateTracker.ts` is rewritten to consume envelope rollups from the services (single source of truth), and the existing scattered status logic in `scanner.tsx`, `index.tsx`, `live.tsx` is deleted.

Exit: all three pages show consistent status, and the rollup is computed once.

### Phase 4 — Simplify product direction

- Primary route `/` becomes "Next-Day & Swing Opportunities" — emphasizes 7-day swing window (already wired) + extended swing.
- `/live` is demoted to "Live (market hours)" and becomes secondary nav. Hidden when market is closed except behind dev mode.
- Remove the intraday-scalper visual cues (1Hz tickers, fast pulse). Quotes refresh at 30s on dashboard, 60s elsewhere.
- AI commentary copy is rewritten to focus on prep / swing / continuation, not scalp signals.

Exit: the home page reads as a swing-prep terminal, not a tape.

### Phase 5 — Rebuild pick quality

`aiScannerService.generatePicks()` runs the gate up front:

```text
required: quote envelope live|delayed AND validated
required: chain envelope live|delayed AND >= N valid contracts after liquidity filter
required: ticker has fresh fundamentals (price, %chg, volume)
optional: sentiment envelope (boost only, not gate)
```

If any required input fails: return `{ picks: [], reason }`. UI renders:
"Insufficient live market data to generate reliable setups." with the missing-input list and a Retry button that calls `router.invalidate()`.

The discipline gate keeps existing label routing, but operates only on candidates that already passed the data-quality gate — no more "Avoid Contract" rows that exist because the data was bad to begin with.

Exit: with a forced provider failure, the dashboard shows the unavailable message and zero picks (instead of mocked rows labeled Avoid).

### Phase 6 — Watchlist on the new foundation

- `watchlistService` reads/writes `localStorage` with schema versioning (`watchlist:v2`), migrates `v1` entries.
- Each entry stores: `entryEnvelope` (snapshot of the quote/contract envelopes at add-time) + `entryScore` + `entryThesis`.
- Live view computes `currentEnvelope` via the services; P/L, AI-confidence delta, expiration decay all read from the same envelopes the rest of the app uses.
- Stale entries (envelope unavailable for >24h) get a "Data unavailable" badge instead of fake green/red.
- Same trust badges as the rest of the app.

Exit: refresh, network off, network on — watchlist behavior is consistent and never invents P/L.

### Phase 7 — UI cleanup (light pass only)

After phases 1–6 land:

- Tighten card density on dashboard (remove unused empty space, two-column hero on desktop).
- Promote the trust strip to the top of every page.
- Cleaner AI commentary block: one rotating insight + one regime line, not three competing widgets.
- No re-skinning, no new pages, no new components beyond the trust set.

Exit: the dashboard above the fold communicates regime + top picks + data trust without scrolling.

### Phase 8 — Production hardening

- Add `services/__tests__/` with unit tests for envelope status transitions, scanner gate, watchlist migration.
- Add a `/diagnostics` route (dev-mode only) that dumps current envelope rollup for every service.
- Sentry-lite: `error-capture.ts` already exists — wire service-level errors through it with envelope context.
- Final pass: `tsc --noEmit`, `bunx vitest run`, click-through smoke test of `/`, `/scanner`, `/watchlist`, `/live` with network on/off.

Exit: typecheck clean, tests green, manual smoke clean.

## Sequencing & PR shape

Phases ship in order. Each phase is a self-contained changeset — the app builds and runs after every phase. Phases 1 and 2 are the heaviest; 3–7 are progressively smaller. I'll start with Phase 1 + 2 together (they're inseparable — you can't remove fake data without somewhere reliable to get real data from), then proceed phase by phase, pausing for your review between phases.

## What I will NOT do in this refactor

- No new features.
- No new pages.
- No visual redesign beyond the trust components and the density pass in Phase 7.
- No new providers, no new AI models, no new connectors.
- No backend / DB / auth changes — this is a frontend-architecture refactor.

## Open questions before I start

1. Are you OK with `/live` being demoted to secondary nav (hidden when market closed)?
2. For the data-quality gate: is "no picks at all" the right behavior when chain data is missing, or do you want to show ticker-only candidates ("data pending") with no contracts?
3. Watchlist `v1 → v2` migration — keep old entries (best-effort re-snapshot from current live data) or archive them and require re-add?

Answer these and I'll start Phase 1 immediately.