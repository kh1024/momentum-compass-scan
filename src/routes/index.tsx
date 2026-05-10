import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { scanIntervalMs, isMarketOpen } from "@/lib/marketHours";
import { MOCK_CANDIDATES } from "@/lib/mockData";
import { marketCommentary } from "@/lib/aiCommentary";
import { CompactTradeCard } from "@/components/CompactTradeCard";
import { TradeDetailDrawer } from "@/components/TradeDetailDrawer";
import { RefreshBar } from "@/components/RefreshBar";
import { StatusPill } from "@/components/trust/StatusPill";
import { deriveLiveState, LIVE_STATE_EXPLAIN, formatAgo } from "@/lib/liveStatus";
import { enrichWithPublicChain, type EnrichmentResult } from "@/lib/chain.functions";
import { getScannerSettingsFn } from "@/lib/massive.functions";
import type { Direction, TradeCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMarketQuotesCompat } from "@/hooks/useMarketQuotesCompat";
import { useRedditSentiment } from "@/hooks/useRedditSentiment";
import { useEarnings } from "@/hooks/useEarnings";
import { applyLiveChain, applyLiveQuote, applyRedditSignal, finalizeCandidate } from "@/lib/applyLiveQuote";
import { expirationBucketFor } from "@/lib/optionQualityValidator";
import { entryModeFromSetup } from "@/lib/entryMode";
import { chainPickKey } from "@/lib/chainKeys";
import { runDisciplineGate, type DisciplineGateResult } from "@/lib/disciplineGate";
import { useRiskFilters } from "@/hooks/useRiskFilters";
import { applyRiskFilters } from "@/lib/riskFilters";
import { sectionFor, SECTION_TITLES, type SectionKey } from "@/lib/uiVocabulary";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import { useAdaptiveIntervals } from "@/hooks/useAdaptiveIntervals";
import { MarketIntelPanel } from "@/components/MarketIntelPanel";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Daily AI Picks — Momentum Options Scanner" }] }),
  component: Dashboard,
});

function regimePlainLabel(bias: string): "Risk On" | "Neutral" | "Risk Off" {
  if (bias === "Risk-on") return "Risk On";
  if (bias === "Risk-off") return "Risk Off";
  return "Neutral";
}

// regimeSummary deprecated — replaced by marketCommentary() inside RegimeCard.

type RegimeQuote = { price: number; changePct: number; ts?: number; sources?: Record<string, number>; agreement?: "verified" | "close" | "mismatch" | "single" };

function CryptoCell({ label, q }: { label: string; q: RegimeQuote | null }) {
  const decimals = label === "BTC" ? 0 : 2;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/10 ring-1 ring-amber-500/30">
        <span className="text-[10px] font-bold tracking-tight text-amber-500">{label}</span>
      </div>
      <div className="flex-1">
        <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label === "BTC" ? "Bitcoin" : label === "SOL" ? "Solana" : label}
        </div>
        {q ? (
          <div className="flex items-baseline gap-2">
            <span className="mono text-sm font-semibold tabular-nums text-foreground">
              ${q.price.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
            </span>
            <span className={cn(
              "mono text-[11px] tabular-nums",
              q.changePct > 0 ? "text-[var(--color-bull)]"
              : q.changePct < 0 ? "text-[var(--color-bear)]"
              : "text-muted-foreground",
            )}>
              {q.changePct >= 0 ? "+" : ""}{q.changePct.toFixed(2)}%
            </span>
          </div>
        ) : (
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">awaiting feed</div>
        )}
      </div>
      <span className={cn(
        "h-1.5 w-1.5 rounded-full",
        q ? "bg-[var(--color-bull)] animate-pulse-dot" : "bg-muted-foreground/40",
      )} />
    </div>
  );
}

function CryptoStrip({ btc, sol }: { btc: RegimeQuote | null; sol: RegimeQuote | null }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <CryptoCell label="BTC" q={btc} />
      <CryptoCell label="SOL" q={sol} />
    </div>
  );
}

function deriveBias(spy: RegimeQuote | null, qqq: RegimeQuote | null, smh: RegimeQuote | null): string {
  const xs = [spy, qqq, smh].filter((x): x is RegimeQuote => !!x);
  if (xs.length === 0) return "Unknown";
  const avg = xs.reduce((a, b) => a + b.changePct, 0) / xs.length;
  if (avg > 0.3) return "Risk On";
  if (avg < -0.3) return "Risk Off";
  return "Neutral";
}

function RegimeCard({
  spy, qqq, smh, updatedAt, isFetching,
}: {
  spy: RegimeQuote | null;
  qqq: RegimeQuote | null;
  smh: RegimeQuote | null;
  updatedAt: number | null;
  isFetching: boolean;
}) {
  const bias = deriveBias(spy, qqq, smh);
  const plain = bias === "Unknown" ? "Unknown" : regimePlainLabel(bias);
  const biasCls =
    plain === "Risk On" ? "text-[var(--color-bull)] bg-[var(--color-bull)]/10 border-[var(--color-bull)]/30"
    : plain === "Risk Off" ? "text-[var(--color-bear)] bg-[var(--color-bear)]/10 border-[var(--color-bear)]/30"
    : plain === "Unknown" ? "text-muted-foreground bg-muted/40 border-border"
    : "text-amber-500 bg-amber-500/10 border-amber-500/30";
  const haveAny = !!(spy || qqq || smh);
  const liveState = deriveLiveState({ updatedAt, isFetching });
  const aiLine = haveAny
    ? marketCommentary({
        spy: spy ? { symbol: "SPY", changePct: spy.changePct } : undefined,
        qqq: qqq ? { symbol: "QQQ", changePct: qqq.changePct } : undefined,
        smh: smh ? { symbol: "SMH", changePct: smh.changePct } : undefined,
        bias,
      })
    : LIVE_STATE_EXPLAIN[liveState];
  const tickerCell = (sym: string, q: RegimeQuote | null) => (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="font-semibold text-muted-foreground">{sym}</span>
      {q ? (
        <>
          <span className="mono tabular-nums text-foreground/90">${q.price.toFixed(2)}</span>
          <span className={cn(
            "mono w-14 text-right tabular-nums",
            q.changePct > 0 ? "text-[var(--color-bull)]"
            : q.changePct < 0 ? "text-[var(--color-bear)]"
            : "text-muted-foreground",
          )}>
            {q.changePct >= 0 ? "+" : ""}{q.changePct.toFixed(2)}%
          </span>
        </>
      ) : (
        <span className="mono w-full text-right tabular-nums text-[10px] uppercase tracking-wider text-muted-foreground/60">
          {liveState === "connecting" ? "connecting…" : "waiting for quote"}
        </span>
      )}
    </div>
  );
  return (
    <div className="rounded-xl border border-border bg-card p-4 min-w-[320px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Market Regime
        </span>
        <span className={cn("rounded-full border px-3 py-1 text-xs font-bold", biasCls)}>
          {plain}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-1">
        {tickerCell("SPY", spy)}
        {tickerCell("QQQ", qqq)}
        {tickerCell("SMH", smh)}
      </div>
      <p className="mt-3 text-[11px] leading-snug text-foreground/80">{aiLine}</p>
      <div className="mt-2 flex items-center justify-between text-[9px] uppercase tracking-wider text-muted-foreground/70">
        <StatusPill state={liveState} updatedAt={updatedAt} showAge={false} />
        <span>{updatedAt ? `Updated ${formatAgo(updatedAt)}` : "No successful refresh yet"}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "bull" | "watch" | "warn" }) {
  const cls =
    tone === "bull" ? "text-[var(--color-bull)]"
    : tone === "watch" ? "text-sky-400"
    : tone === "warn" ? "text-amber-500"
    : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold leading-none tabular-nums", cls)}>{value}</div>
    </div>
  );
}

const SECTION_ORDER: SectionKey[] = ["high-conviction", "momentum", "near-entry", "aggressive", "lottery", "watch"];

function Dashboard() {
  const [dir, setDir] = useState<Direction | "ALL">("ALL");
  const [sectionFilter, setSectionFilter] = useState<SectionKey | "ALL">("ALL");
  const [openId, setOpenId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [devMode] = useDeveloperMode();

  // Freshness labels self-tick. Don't trigger a per-second dashboard re-render
  // — that re-mounts every trade card and causes the visible "flicker".

  const qc = useQueryClient();
  const enrichFn = useServerFn(enrichWithPublicChain);
  const fetchScannerSettings = useServerFn(getScannerSettingsFn);
  const { data: scannerSettings } = useQuery({
    queryKey: ["scanner-settings"],
    queryFn: () => fetchScannerSettings(),
    staleTime: 60_000,
  });
  // Cadence: 30 min during market hours, once per day off-hours.
  // Server `fullScanIntervalMs` is honored only if it's smaller than the
  // market-aware default (e.g. admin override).
  const marketAwareIntervalMs = scanIntervalMs();
  const serverInterval = scannerSettings?.fullScanIntervalMs ?? 0;
  const fullScanIntervalMs =
    serverInterval > 0 && serverInterval < marketAwareIntervalMs
      ? serverInterval
      : marketAwareIntervalMs;

  const picks = useMemo(
    () =>
      MOCK_CANDIDATES.map((c) => ({
        ticker: c.ticker,
        direction: c.direction,
        isLeaps: c.setupType === "LEAPS",
        isYolo: c.setupType === "Reddit YOLO",
        entryMode: entryModeFromSetup(c.setupType),
        targetStrike: entryModeFromSetup(c.setupType) === "Breakout" ? c.levels.baseHigh : c.price,
      })),
    [],
  );

  const {
    data: chainData,
    isFetching: isScanning,
    refetch: refetchChain,
    error: chainError,
    dataUpdatedAt,
  } = useQuery<EnrichmentResult>({
    queryKey: ["dashboard-chain", picks.map((p) => `${p.ticker}:${p.direction}`).join(",")],
    queryFn: () => enrichFn({ data: { picks } }),
    enabled: picks.length > 0,
    refetchInterval: autoRefresh && fullScanIntervalMs > 0 ? fullScanIntervalMs : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: fullScanIntervalMs > 0 ? Math.max(fullScanIntervalMs - 10_000, 60_000) : 24 * 60 * 60_000,
    placeholderData: (previousData) => previousData,
  });

  useEffect(() => {
    if (chainError) {
      toast.error("Scanner request failed", {
        description: chainError instanceof Error ? chainError.message : String(chainError),
      });
    }
  }, [chainError]);

  const lastRateLimitedRef = useRef(false);
  useEffect(() => {
    if (!chainData) return;
    const now = chainData.rateLimited;
    if (now && !lastRateLimitedRef.current) {
      toast.warning("Rate limit hit", { description: chainData.message ?? "Showing last known data.", duration: 6000 });
    } else if (!now && lastRateLimitedRef.current) {
      toast.success("Live data restored");
    }
    lastRateLimitedRef.current = now;
  }, [chainData]);

  // Always include the three index proxies used by RegimeCard so the regime
  // panel actually receives quotes — without these, getLive("SPY"/"QQQ"/"SMH")
  // permanently returns null and the panel sticks on "WAITING FOR QUOTE".
  const symbols = useMemo(
    () => Array.from(new Set(["SPY", "QQQ", "SMH", ...MOCK_CANDIDATES.map((c) => c.ticker)])),
    [],
  );
  // Adaptive cadence: tracks market session (open / pre / after / closed / weekend).
  const intervals = useAdaptiveIntervals();
  const quoteRefreshIntervalMs = typeof intervals.quotes === "number" ? intervals.quotes : 10 * 60_000;
  const { get: getLive, anyLive } = useMarketQuotesCompat(symbols, { refetchIntervalMs: quoteRefreshIntervalMs });
  // Crypto trades 24/7 — keep a fixed 60s refresh.
  const { get: getCrypto } = useMarketQuotesCompat(["BTC-USD", "SOL-USD"], { refetchIntervalMs: 60_000 });
  const { get: getReddit } = useRedditSentiment(symbols, { refetchIntervalMs: intervals.sentiment });
  const { get: getEarnings } = useEarnings(symbols, 60);
  void getEarnings;

  const traces = useMemo(() => {
    const enriched = chainData?.enriched ?? {};
    return MOCK_CANDIDATES.map((c) => {
      const isLeaps = c.setupType === "LEAPS";
      const isYolo = c.setupType === "Reddit YOLO";
      const base = applyRedditSignal(applyLiveQuote(c, getLive(c.ticker)), getReddit(c.ticker));
      const entryMode = entryModeFromSetup(c.setupType);
      const key = chainPickKey(c.ticker, c.direction, { isLeaps, isYolo, entryMode });
      const withChain = applyLiveChain(base, enriched[key] ?? null);
      const finalized = finalizeCandidate(withChain);
      const gate = runDisciplineGate(finalized, { extendedSwingEnabled: true });
      const merged: TradeCandidate = {
        ...finalized,
        score: gate.finalScore,
        finalScore: gate.finalScore,
        label: gate.displayLabel,
        originalLabel: gate.baseLabel !== gate.displayLabel ? gate.baseLabel : undefined,
        sectionRouted: gate.routedSection === "hidden" ? expirationBucketFor(finalized.contract.dte) : gate.routedSection,
        dteBucketLabel: expirationBucketFor(finalized.contract.dte),
        validationOk: gate.visible && gate.finalLabel !== "Avoid",
        validationReason: gate.reasons.join(" · "),
        buyNowEligible: gate.buyNowEligible,
        buyNowBlockers: gate.buyNowBlockers,
      };
      const section = sectionFor(merged);
      return { c: merged, gate, section };
    });
  }, [chainData, getLive, getReddit]);

  // In normal mode hide low-quality / unhideable picks. Dev mode shows everything.
  const { filters: riskFilters, auto: riskAuto } = useRiskFilters();
  const candidates = useMemo(
    () => applyRiskFilters(
      traces.filter((t) => devMode || t.section !== null).map((t) => t.c),
      riskFilters,
      riskAuto,
    ),
    [traces, devMode, riskFilters, riskAuto],
  );

  const sectionMap = useMemo(() => {
    const map: Record<SectionKey, TradeCandidate[]> = {
      "high-conviction": [], "momentum": [], "near-entry": [], "aggressive": [], "lottery": [], "watch": [],
    };
    for (const t of traces) {
      if (!t.section) continue;
      if (dir !== "ALL" && t.c.direction !== dir) continue;
      map[t.section].push(t.c);
    }
    // Promote a few "Momentum" entries from high-conviction with active triggers.
    map["momentum"] = map["high-conviction"]
      .filter((c) => c.triggerStatus === "active" && (c.finalScore ?? c.score) >= 80)
      .slice(0, 6);
    // Sort each section by score desc.
    for (const k of SECTION_ORDER) {
      map[k] = map[k].slice().sort((a, b) => (b.finalScore ?? b.score) - (a.finalScore ?? a.score));
    }
    return map;
  }, [traces, dir]);

  const bestOverall = useMemo(() => {
    return candidates
      .filter((c) => dir === "ALL" || c.direction === dir)
      .sort((a, b) => (b.finalScore ?? b.score) - (a.finalScore ?? a.score))
      .slice(0, 3);
  }, [candidates, dir]);

  const counts = useMemo(() => ({
    total: candidates.length,
    highConviction: sectionMap["high-conviction"].length,
    momentum: sectionMap["momentum"].length,
    nearEntry: sectionMap["near-entry"].length,
    aggressive: sectionMap["aggressive"].length,
    lottery: sectionMap["lottery"].length,
  }), [candidates, sectionMap]);

  const traceById = useMemo(() => {
    const m = new Map<string, { c: TradeCandidate; gate: DisciplineGateResult }>();
    for (const t of traces) m.set(t.c.id, t);
    return m;
  }, [traces]);
  const open = openId ? traceById.get(openId) ?? null : null;

  const liveQuoteUpdatedAt = useMemo(() => {
    let max = 0;
    for (const s of symbols) {
      const q = getLive(s);
      if (q?.ts) max = Math.max(max, q.ts);
    }
    return max || null;
  }, [symbols, getLive]);

  const lastFullScanAt = dataUpdatedAt || null;
  const nextFullScanAt =
    autoRefresh && fullScanIntervalMs > 0 && lastFullScanAt
      ? lastFullScanAt + fullScanIntervalMs
      : null;

  const spyLive = getLive("SPY");
  const qqqLive = getLive("QQQ");
  const smhLive = getLive("SMH");
  const spyQ: RegimeQuote | null = spyLive ?? null;
  const qqqQ: RegimeQuote | null = qqqLive ?? null;
  const smhQ: RegimeQuote | null = smhLive ?? null;
  const regimeUpdatedAt =
    Math.max(
      spyLive?.ts ?? 0,
      qqqLive?.ts ?? 0,
      smhLive?.ts ?? 0,
    ) || null;

  // Unified freshness across SPY/QQQ/SMH regime quotes + per-ticker live quotes.
  const marketDataUpdatedAt =
    Math.max(regimeUpdatedAt ?? 0, liveQuoteUpdatedAt ?? 0) || null;

  // Truthful live states — NEVER show "live" without a recent successful fetch.
  const quoteState = deriveLiveState({
    updatedAt: marketDataUpdatedAt,
    isFetching: isScanning,
    rateLimited: chainData?.rateLimited === true,
    kind: "quote",
  });
  const chainState = deriveLiveState({
    updatedAt: lastFullScanAt,
    isFetching: isScanning,
    rateLimited: chainData?.rateLimited === true,
    hasError: !!chainError,
    kind: "chain",
  });

  const dataMode: "live" | "cached" | "delayed" =
    chainData?.rateLimited ? "delayed"
    : quoteState === "live" ? "live"
    : "cached";

  const onRunScanNow = () => { void refetchChain(); };
  const onRefreshQuotesOnly = () => {
    void Promise.all([
      qc.invalidateQueries({ queryKey: ["live-quotes"] }),
      qc.invalidateQueries({ queryKey: ["reddit-sentiment"] }),
    ]);
    toast.success("Refreshing quotes…");
  };

  const Pill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-muted",
      )}
    >
      {children}
    </button>
  );

  const renderSection = (key: SectionKey, list: TradeCandidate[]) => {
    if (list.length === 0) return null;
    if (sectionFilter !== "ALL" && sectionFilter !== key) return null;
    return (
      <section key={key}>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-wide">
            {SECTION_TITLES[key]}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{list.length}</span>
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => (
            <CompactTradeCard key={t.id} t={t} onOpenDetails={() => setOpenId(t.id)} />
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-5">
      <CryptoStrip btc={getCrypto("BTC-USD") ?? null} sol={getCrypto("SOL-USD") ?? null} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Daily AI Picks</h1>
          <p className="text-xs text-muted-foreground">
            Best options opportunities for the next few days · ranked by AI confidence
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <StatusPill state={quoteState} updatedAt={marketDataUpdatedAt} source="market" />
            <span className="h-3 w-px bg-border" />
            <span>{counts.total} ideas · {counts.highConviction} high conviction</span>
            <span className="h-3 w-px bg-border" />
            <span title={isMarketOpen() ? "Market open — scanning every 30 minutes" : "Market closed — scanning once per day"}>
              <span className={cn("font-semibold", isMarketOpen() ? "text-[var(--color-bull)]" : "text-muted-foreground")}>
                {isMarketOpen() ? "Market Open" : "Market Closed"}
              </span>
              {" · "}
              {isMarketOpen() ? "30 min" : "daily"} scan
            </span>
          </div>
        </div>
        <RegimeCard spy={spyQ} qqq={qqqQ} smh={smhQ} updatedAt={regimeUpdatedAt} isFetching={isScanning} />
      </div>

      <MarketIntelPanel />

      <RefreshBar
        lastFullScanAt={lastFullScanAt}
        nextFullScanAt={nextFullScanAt}
        marketDataUpdatedAt={marketDataUpdatedAt}
        optionQuoteUpdatedAt={lastFullScanAt}
        dataMode={dataMode}
        quoteState={quoteState}
        chainState={chainState}
        autoRefresh={autoRefresh && fullScanIntervalMs > 0}
        isScanning={isScanning}
        onRunScanNow={onRunScanNow}
        onRefreshQuotesOnly={onRefreshQuotesOnly}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
      />

      {(() => {
        // Calm, market-aware banner. Only show the amber "needs attention"
        // variant when the market is OPEN and quotes are genuinely missing.
        const open = isMarketOpen();
        const showAttention = open && (quoteState === "unavailable" || quoteState === "error" || quoteState === "stale");
        const showInfo = !open || quoteState === "connecting" || quoteState === "awaiting" || quoteState === "market-closed";
        if (!showAttention && !showInfo) return null;
        const tone = showAttention
          ? "border-amber-500/30 bg-amber-500/[0.04]"
          : "border-border bg-muted/20";
        const dotTone = showAttention ? "bg-amber-500 animate-pulse-dot" : "bg-muted-foreground/50";
        const titleTone = showAttention ? "text-amber-500" : "text-muted-foreground";
        const title = showAttention
          ? quoteState === "stale" ? "Awaiting fresh quotes"
            : quoteState === "error" ? "Quote provider reconnecting"
            : "Waiting for live quote provider"
          : !open ? "Tomorrow Preparation Mode"
            : quoteState === "connecting" ? "Connecting to market data"
            : "Awaiting next refresh";
        const detail = !open
          ? "Market closed — showing latest verified scan · Live refresh paused outside market hours"
          : LIVE_STATE_EXPLAIN[quoteState] + (marketDataUpdatedAt ? ` · Last refresh ${formatAgo(marketDataUpdatedAt)}` : "");
        return (
          <div className={cn("flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs", tone)}>
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", dotTone)} />
              <span className={cn("font-semibold uppercase tracking-wider", titleTone)}>{title}</span>
              <span className="text-muted-foreground">{detail}</span>
            </div>
            {open && (
              <button
                onClick={onRefreshQuotesOnly}
                className="rounded-md border border-border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/80 hover:bg-muted"
              >
                Retry quotes
              </button>
            )}
          </div>
        );
      })()}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total" value={counts.total} />
        <Stat label="High Conviction" value={counts.highConviction} tone="bull" />
        <Stat label="Momentum" value={counts.momentum} tone="bull" />
        <Stat label="Near Entry" value={counts.nearEntry} tone="watch" />
        <Stat label="Aggressive" value={counts.aggressive} tone="warn" />
        <Stat label="Lottery" value={counts.lottery} tone="warn" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5">
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Direction</span>
          {(["ALL", "CALL", "PUT"] as const).map((d) => (
            <Pill key={d} active={dir === d} onClick={() => setDir(d)}>{d}</Pill>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Section</span>
          <Pill active={sectionFilter === "ALL"} onClick={() => setSectionFilter("ALL")}>All</Pill>
          {SECTION_ORDER.map((k) => (
            <Pill key={k} active={sectionFilter === k} onClick={() => setSectionFilter(k)}>{SECTION_TITLES[k]}</Pill>
          ))}
        </div>
      </div>

      {/* Best Overall */}
      {sectionFilter === "ALL" && bestOverall.length > 0 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold tracking-wide">
              Best Overall
              <span className="ml-2 text-xs font-normal text-muted-foreground">Top 3</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {bestOverall.map((t) => (
              <CompactTradeCard key={`best-${t.id}`} t={t} onOpenDetails={() => setOpenId(t.id)} />
            ))}
          </div>
        </section>
      )}

      {/* Sections */}
      {SECTION_ORDER.map((key) => renderSection(key, sectionMap[key]))}

      {counts.total === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No qualifying setups right now. The AI is waiting for cleaner opportunities.
        </div>
      )}

      <TradeDetailDrawer
        open={!!open}
        onOpenChange={(v) => !v && setOpenId(null)}
        t={open?.c ?? null}
        gate={open?.gate ?? null}
      />
    </div>
  );
}
