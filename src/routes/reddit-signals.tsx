import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { toast } from "sonner";
import { Flame, TrendingUp, TrendingDown, Star, AlertTriangle, RefreshCw, MessageSquare, Activity } from "lucide-react";
import { useRedditTrending } from "@/hooks/useRedditTrending";
import { useMarketQuotesCompat } from "@/hooks/useMarketQuotesCompat";
import { useWatchlist } from "@/hooks/useWatchlist";
import { watchlistService } from "@/services/watchlistService";
import { wrap } from "@/services/trust";
import { StatusPill } from "@/components/trust/StatusPill";
import { deriveLiveState, formatAgo, LIVE_STATE_EXPLAIN } from "@/lib/liveStatus";
import { cn } from "@/lib/utils";
import type {
  RedditTrendingEntry,
  TrendingCategory,
} from "@/lib/redditTrending.functions";
import type { Quote } from "@/services/marketDataService";
import type { TrustEnvelope } from "@/services/trust";

export const Route = createFileRoute("/reddit-signals")({
  head: () => ({
    meta: [
      { title: "Reddit Signals — Momentum AI" },
      { name: "description", content: "Track retail sentiment and trending tickers across r/wallstreetbets, r/options, r/stocks and more, cross-checked against live price action." },
      { property: "og:title", content: "Reddit Signals — Momentum AI" },
      { property: "og:description", content: "Discover tickers gaining retail attention with AI interpretation and live price cross-checks." },
    ],
  }),
  component: RedditSignalsPage,
});

const CATEGORY_ORDER: TrendingCategory[] = [
  "Trending",
  "Bullish Momentum",
  "Bearish Momentum",
  "Options Hype",
  "Lottery Watch",
  "Contrarian Watch",
  "Too Much Hype",
];

const CATEGORY_META: Record<TrendingCategory, { label: string; icon: typeof Flame; tone: string }> = {
  "Trending":          { label: "Trending Now",       icon: Flame,           tone: "text-amber-400" },
  "Bullish Momentum":  { label: "Bullish Momentum",   icon: TrendingUp,      tone: "text-[var(--color-bull)]" },
  "Bearish Momentum":  { label: "Bearish Momentum",   icon: TrendingDown,    tone: "text-[var(--color-bear)]" },
  "Options Hype":      { label: "Options Hype",       icon: Activity,        tone: "text-sky-400" },
  "Lottery Watch":     { label: "Lottery Watch",      icon: Star,            tone: "text-[var(--color-lotto)]" },
  "Contrarian Watch":  { label: "Contrarian Watch",   icon: AlertTriangle,   tone: "text-amber-500" },
  "Too Much Hype":     { label: "Avoid — Too Much Hype", icon: AlertTriangle,tone: "text-[var(--color-bear)]" },
};

function RedditSignalsPage() {
  const { data, isLoading, isFetching, isError, refetch } = useRedditTrending(60);
  const entries = data?.entries ?? [];

  // Cross-check tickers against live quotes (top 30 only to bound API calls).
  const topTickers = useMemo(() => entries.slice(0, 30).map(e => e.ticker), [entries]);
  const { get: getQuote, anyLive } = useMarketQuotesCompat(topTickers, {
    refetchIntervalMs: 60_000,
    enabled: topTickers.length > 0,
  });

  const watchlist = useWatchlist();

  const liveState = deriveLiveState({
    updatedAt: data?.fetchedAt ?? null,
    isFetching,
    hasError: isError || !!data?.error,
  });

  const grouped = useMemo(() => {
    const m: Record<TrendingCategory, RedditTrendingEntry[]> = {
      "Trending": [], "Bullish Momentum": [], "Bearish Momentum": [],
      "Options Hype": [], "Lottery Watch": [], "Contrarian Watch": [], "Too Much Hype": [],
    };
    for (const e of entries) m[e.category].push(e);
    return m;
  }, [entries]);

  const overview = useMemo(() => {
    const sorted = [...entries];
    return {
      topTrending: [...sorted].sort((a, b) => b.mentions - a.mentions).slice(0, 5),
      fastestRising: [...sorted].sort((a, b) => b.mentionsDeltaPct - a.mentionsDeltaPct).slice(0, 5),
      mostBullish: [...sorted].filter(e => e.sentiment === "Bullish").sort((a, b) => (b.bullishRatio * b.mentions) - (a.bullishRatio * a.mentions)).slice(0, 5),
      mostBearish: [...sorted].filter(e => e.sentiment === "Bearish").sort((a, b) => ((1 - b.bullishRatio) * b.mentions) - ((1 - a.bullishRatio) * a.mentions)).slice(0, 5),
      optionsHype: [...sorted].filter(e => e.optionsFocus).sort((a, b) => b.mentions - a.mentions).slice(0, 5),
      speculative: [...sorted].filter(e => e.category === "Lottery Watch" || e.category === "Too Much Hype").slice(0, 5),
    };
  }, [entries]);

  const handleRefresh = () => {
    refetch();
    toast.success("Refreshing Reddit signals…");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-amber-400" />
            Reddit Signals
          </h1>
          <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
            Tickers gaining attention across r/wallstreetbets, r/options, r/stocks and more —
            classified by AI and cross-checked against live price action. A discovery tool, not a blind hype machine.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusPill state={liveState} updatedAt={data?.fetchedAt ?? null} source="reddit + ai" />
            {data?.sourcesUsed && data.sourcesUsed.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {data.sourcesUsed.length} subreddit{data.sourcesUsed.length === 1 ? "" : "s"} · {entries.length} tickers
              </span>
            )}
            {data?.aiAvailable === false && data?.entries.length ? (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-500">
                AI interpretation unavailable — heuristic mode
              </span>
            ) : null}
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Error / empty / loading banners */}
      {isLoading && entries.length === 0 && (
        <EmptyState
          tone="info"
          title="Connecting to Reddit signal provider…"
          body="Fetching mentions across active subreddits. This usually takes a few seconds."
        />
      )}

      {!isLoading && data?.error && (
        <EmptyState
          tone="warn"
          title="Reddit signal provider unavailable"
          body={data.error + " — using last known data when available."}
        />
      )}

      {!isLoading && !data?.error && entries.length === 0 && (
        <EmptyState
          tone="neutral"
          title="No trending tickers detected"
          body="Retail chatter is quiet right now. AI is waiting for a clearer signal before surfacing names."
        />
      )}

      {entries.length > 0 && (
        <>
          {/* Overview strips */}
          <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <OverviewList title="Top Trending"     tickers={overview.topTrending}     icon={Flame}     tone="text-amber-400" />
            <OverviewList title="Fastest Rising"   tickers={overview.fastestRising}   icon={TrendingUp} tone="text-[var(--color-bull)]" />
            <OverviewList title="Most Bullish"     tickers={overview.mostBullish}     icon={TrendingUp} tone="text-[var(--color-bull)]" />
            <OverviewList title="Most Bearish"     tickers={overview.mostBearish}     icon={TrendingDown} tone="text-[var(--color-bear)]" />
            <OverviewList title="Options Hype"     tickers={overview.optionsHype}     icon={Activity}  tone="text-sky-400" />
            <OverviewList title="Speculative Hype" tickers={overview.speculative}     icon={Star}      tone="text-[var(--color-lotto)]" />
          </section>

          {/* Grouped categories */}
          {CATEGORY_ORDER.map((cat) => {
            const list = grouped[cat];
            if (list.length === 0) return null;
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            return (
              <section key={cat}>
                <div className="mb-2 flex items-baseline gap-2">
                  <Icon className={cn("h-4 w-4", meta.tone)} />
                  <h2 className="text-sm font-semibold tracking-wide">{meta.label}</h2>
                  <span className="text-xs text-muted-foreground">{list.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {list.map((e) => (
                    <SignalCard
                      key={e.ticker}
                      entry={e}
                      quote={getQuote(e.ticker)}
                      isWatched={watchlist.has(`${e.ticker}:reddit`)}
                      anyLiveQuotes={anyLive}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function EmptyState({ tone, title, body }: { tone: "info" | "warn" | "neutral"; title: string; body: string }) {
  const cls =
    tone === "warn" ? "border-amber-500/30 bg-amber-500/[0.04]"
    : tone === "info" ? "border-sky-500/30 bg-sky-500/[0.04]"
    : "border-border bg-card/60";
  const dot =
    tone === "warn" ? "bg-amber-500"
    : tone === "info" ? "bg-sky-400 animate-pulse-dot"
    : "bg-muted-foreground/60";
  return (
    <div className={cn("rounded-xl border p-5", cls)}>
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", dot)} />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="mt-1.5 ml-4 text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function OverviewList({
  title, tickers, icon: Icon, tone,
}: {
  title: string;
  tickers: RedditTrendingEntry[];
  icon: typeof Flame;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5", tone)} />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</span>
      </div>
      {tickers.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70">No qualifying tickers right now.</p>
      ) : (
        <ol className="space-y-1">
          {tickers.map((t, i) => (
            <li key={t.ticker} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="flex items-baseline gap-1.5">
                <span className="mono w-4 text-right tabular-nums text-muted-foreground/60">{i + 1}</span>
                <span className="font-semibold tracking-tight">{t.ticker}</span>
              </span>
              <span className="mono tabular-nums text-muted-foreground">
                {t.mentions} mentions
                {t.mentionsDeltaPct > 0 && (
                  <span className="ml-1.5 text-[var(--color-bull)]">+{Math.round(t.mentionsDeltaPct * 100)}%</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SignalCard({
  entry: e, quote, isWatched, anyLiveQuotes,
}: {
  entry: RedditTrendingEntry;
  quote: { price: number; changePct: number; ts?: number } | null;
  isWatched: boolean;
  anyLiveQuotes: boolean;
}) {
  const sentimentTone =
    e.sentiment === "Bullish" ? "text-[var(--color-bull)] bg-[var(--color-bull)]/10 border-[var(--color-bull)]/30"
    : e.sentiment === "Bearish" ? "text-[var(--color-bear)] bg-[var(--color-bear)]/10 border-[var(--color-bear)]/30"
    : e.sentiment === "Hype" ? "text-amber-500 bg-amber-500/10 border-amber-500/30"
    : e.sentiment === "Mixed" ? "text-sky-400 bg-sky-400/10 border-sky-400/30"
    : "text-muted-foreground bg-muted/30 border-border";

  const trendBadge =
    e.trend === "Rising" ? { tone: "text-[var(--color-bull)]", label: "↗ Rising" }
    : e.trend === "Falling" ? { tone: "text-[var(--color-bear)]", label: "↘ Falling" }
    : { tone: "text-muted-foreground", label: "→ Flat" };

  // Cross-checks against live price.
  const xchecks: { label: string; ok: boolean }[] = [];
  if (quote) {
    const priceUp = quote.changePct > 0.3;
    const priceDown = quote.changePct < -0.3;
    if (e.sentiment === "Bullish") xchecks.push({ label: priceUp ? "Confirmed by price action" : "Reddit-only hype", ok: priceUp });
    if (e.sentiment === "Bearish") xchecks.push({ label: priceDown ? "Price confirms bearish" : "Bearish chatter, neutral price", ok: priceDown });
    if (e.optionsFocus) xchecks.push({ label: "Options flow aligned", ok: true });
    if (e.trend === "Rising" && (priceUp || priceDown)) xchecks.push({ label: "Momentum confirmed", ok: true });
  } else if (anyLiveQuotes) {
    xchecks.push({ label: "Outside top-30 watch list — no live quote", ok: false });
  }

  const handleToggleWatchlist = () => {
    const id = `${e.ticker}:reddit`;
    if (isWatched) {
      watchlistService.remove(id);
      toast.success(`${e.ticker} removed from watchlist`);
      return;
    }
    const direction: "CALL" | "PUT" = e.sentiment === "Bearish" ? "PUT" : "CALL";
    const entryQuote: TrustEnvelope<Quote> = wrap<Quote>({
      value: quote && Number.isFinite(quote.price)
        ? {
            symbol: e.ticker,
            price: quote.price,
            change: 0,
            changePct: quote.changePct,
            volume: 0,
            ts: quote.ts ?? Date.now(),
            consensusSource: "reddit-signals",
            sources: {},
            agreement: "single",
            diffPct: null,
          }
        : null,
      source: "computed",
      fetchedAt: quote?.ts ?? Date.now(),
      validated: !!(quote && Number.isFinite(quote.price)),
    });
    watchlistService.add({
      v: 2,
      id,
      ticker: e.ticker,
      direction,
      setupType: "Reddit YOLO",
      label: e.category,
      addedAt: Date.now(),
      entryQuote,
      entryStockPrice: quote?.price ?? 0,
      entryScore: Math.round(e.bullishRatio * 100),
      entryThesis: e.interpretation,
      archivedAt: null,
    });
    toast.success(`${e.ticker} added to watchlist`, { description: e.interpretation });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight">{e.ticker}</span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider", sentimentTone)}>
              {e.sentiment}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>r/{e.topSource}</span>
            <span>·</span>
            <span className={trendBadge.tone}>{trendBadge.label}</span>
            {e.classifiedBy === "ai" && (
              <>
                <span>·</span>
                <span className="text-foreground/50">AI-classified</span>
              </>
            )}
          </div>
        </div>
        {quote && (
          <div className="text-right">
            <div className="mono text-sm font-semibold tabular-nums">${quote.price.toFixed(2)}</div>
            <div className={cn(
              "mono text-[11px] tabular-nums",
              quote.changePct > 0 ? "text-[var(--color-bull)]"
              : quote.changePct < 0 ? "text-[var(--color-bear)]"
              : "text-muted-foreground",
            )}>
              {quote.changePct >= 0 ? "+" : ""}{quote.changePct.toFixed(2)}%
            </div>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
        <Stat label="Mentions" value={e.mentions.toLocaleString()} sub={e.mentionsDeltaPct !== 0 ? `${e.mentionsDeltaPct > 0 ? "+" : ""}${Math.round(e.mentionsDeltaPct * 100)}%` : "flat"} tone={e.mentionsDeltaPct > 0 ? "bull" : e.mentionsDeltaPct < 0 ? "bear" : "neutral"} />
        <Stat label="Bullish" value={`${Math.round(e.bullishRatio * 100)}%`} tone={e.bullishRatio > 0.6 ? "bull" : e.bullishRatio < 0.4 ? "bear" : "neutral"} />
        <Stat label="Rank" value={`#${e.bestRank}`} sub={e.rankDelta !== 0 ? `${e.rankDelta > 0 ? "↑" : "↓"}${Math.abs(e.rankDelta)}` : "—"} tone={e.rankDelta > 0 ? "bull" : e.rankDelta < 0 ? "bear" : "neutral"} />
      </div>

      {/* Bullish ratio bar */}
      <div className="mt-3">
        <div className="h-1 overflow-hidden rounded-full bg-gradient-to-r from-[var(--color-bear)]/40 via-amber-500/30 to-[var(--color-bull)]/40">
          <div className="h-full bg-foreground/70" style={{ width: "2px", marginLeft: `calc(${e.bullishRatio * 100}% - 1px)` }} />
        </div>
        <div className="mt-0.5 flex justify-between text-[8px] uppercase tracking-wider text-muted-foreground/60">
          <span>Bearish</span><span>Bullish</span>
        </div>
      </div>

      {/* AI interpretation */}
      <p className="mt-3 text-[11px] leading-snug text-foreground/85">{e.interpretation}</p>

      {/* Themes */}
      {e.themes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {e.themes.map((th) => (
            <span key={th} className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
              {th}
            </span>
          ))}
        </div>
      )}

      {/* Cross-checks */}
      {xchecks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {xchecks.map((x, i) => (
            <span
              key={i}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                x.ok
                  ? "border-[var(--color-bull)]/30 bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-500",
              )}
            >
              {x.label}
            </span>
          ))}
        </div>
      )}

      {/* Risk note */}
      {e.riskNote && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1 text-[10px] text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          {e.riskNote}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {e.sources.slice(0, 4).map((s) => (
            <span key={s} className="text-[9px] text-muted-foreground/70">r/{s}</span>
          ))}
        </div>
        <button
          onClick={handleToggleWatchlist}
          className={cn(
            "rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
            isWatched
              ? "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
              : "border-border bg-background hover:bg-muted",
          )}
        >
          {isWatched ? "✓ On Watchlist" : "+ Watchlist"}
        </button>
      </div>

      <div className="mt-2 text-[9px] text-muted-foreground/50">
        Updated {formatAgo(e.mentions > 0 ? Date.now() - 60_000 : null)} · {LIVE_STATE_EXPLAIN.live}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bull" | "bear" | "neutral" }) {
  const cls =
    tone === "bull" ? "text-[var(--color-bull)]"
    : tone === "bear" ? "text-[var(--color-bear)]"
    : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={cn("mono text-xs font-semibold tabular-nums", cls)}>{value}</span>
        {sub && <span className="text-[9px] text-muted-foreground/60">{sub}</span>}
      </div>
    </div>
  );
}
