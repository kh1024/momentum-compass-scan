import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { scanIntervalMs, isMarketOpen } from "@/lib/marketHours";
import { MOCK_CANDIDATES, MOCK_REGIME } from "@/lib/mockData";
import { CompactTradeCard } from "@/components/CompactTradeCard";
import { TradeDetailDrawer } from "@/components/TradeDetailDrawer";
import { RefreshBar } from "@/components/RefreshBar";
import { enrichWithPublicChain, type EnrichmentResult } from "@/lib/chain.functions";
import { getScannerSettingsFn } from "@/lib/massive.functions";
import type { Direction, TradeCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useRedditSentiment } from "@/hooks/useRedditSentiment";
import { useEarnings } from "@/hooks/useEarnings";
import { applyLiveChain, applyLiveQuote, applyRedditSignal, finalizeCandidate } from "@/lib/applyLiveQuote";
import { expirationBucketFor } from "@/lib/optionQualityValidator";
import { entryModeFromSetup } from "@/lib/entryMode";
import { chainPickKey } from "@/lib/chainKeys";
import { runDisciplineGate, type DisciplineGateResult } from "@/lib/disciplineGate";
import { sectionFor, SECTION_TITLES, type SectionKey } from "@/lib/uiVocabulary";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Daily AI Picks — Momentum Options Scanner" }] }),
  component: Dashboard,
});

function regimePlainLabel(bias: string): "Risk On" | "Neutral" | "Risk Off" {
  if (bias === "Risk-on") return "Risk On";
  if (bias === "Risk-off") return "Risk Off";
  return "Neutral";
}

function regimeSummary(bias: string, spy: { changePct: number }, qqq: { changePct: number }, smh: { changePct: number }): string {
  const avg = (spy.changePct + qqq.changePct + smh.changePct) / 3;
  if (bias === "Risk-on" || avg > 0.3) return "Broad strength across SPY/QQQ/SMH — supportive for calls.";
  if (bias === "Risk-off" || avg < -0.3) return "Indices weak — favor puts and reduce size on calls.";
  return "Mixed tape — selectivity matters; lean on strongest setups only.";
}

type RegimeQuote = { price: number; changePct: number; sources?: Record<string, number>; agreement?: "verified" | "close" | "mismatch" | "single" };


function RegimeCard({
  bias, spy, qqq, smh,
}: {
  bias: string;
  spy: RegimeQuote;
  qqq: RegimeQuote;
  smh: RegimeQuote;
}) {
  const plain = regimePlainLabel(bias);
  const biasCls =
    plain === "Risk On" ? "text-[var(--color-bull)] bg-[var(--color-bull)]/10 border-[var(--color-bull)]/30"
    : plain === "Risk Off" ? "text-[var(--color-bear)] bg-[var(--color-bear)]/10 border-[var(--color-bear)]/30"
    : "text-amber-500 bg-amber-500/10 border-amber-500/30";
  return (
    <div className="rounded-xl border border-border bg-card p-4 min-w-[300px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Market Regime
        </span>
        <span className={cn("rounded-full border px-3 py-1 text-xs font-bold", biasCls)}>
          {plain}
        </span>
      </div>
      <p className="mt-3 text-[12px] leading-snug text-foreground/90">
        {regimeSummary(bias, spy, qqq, smh)}
      </p>
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

  // Tick once per second so refresh-bar labels update.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

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

  const symbols = useMemo(() => Array.from(new Set(MOCK_CANDIDATES.map((c) => c.ticker))), []);
  const { get: getLive, anyLive } = useLiveQuotes(symbols);
  const { get: getReddit } = useRedditSentiment(symbols);
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
  const candidates = useMemo(
    () => traces.filter((t) => devMode || t.section !== null).map((t) => t.c),
    [traces, devMode],
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

  const dataMode: "live" | "cached" | "delayed" | "demo" =
    chainData?.rateLimited ? "delayed"
    : anyLive && (chainData?.enriched && Object.values(chainData.enriched).some((v) => v !== null)) ? "live"
    : anyLive ? "cached"
    : "demo";

  type RQ = { price: number; changePct: number; sources?: Record<string, number>; agreement?: "verified" | "close" | "mismatch" | "single" };
  const regimeData = qc.getQueryData<{ live: boolean; quotes?: { SPY?: RQ; QQQ?: RQ; SMH?: RQ } }>(["regime-quotes"]);
  const spyQ = regimeData?.quotes?.SPY ?? MOCK_REGIME.spy;
  const qqqQ = regimeData?.quotes?.QQQ ?? MOCK_REGIME.qqq;
  const smhQ = regimeData?.quotes?.SMH ?? MOCK_REGIME.smh;

  const onRunScanNow = () => { void refetchChain(); };
  const onRefreshQuotesOnly = () => {
    void qc.invalidateQueries({ queryKey: ["live-quotes"] });
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Daily AI Picks</h1>
          <p className="text-xs text-muted-foreground">
            Best options opportunities for the next few days · ranked by AI confidence
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className={cn("font-semibold", dataMode === "live" ? "text-[var(--color-bull)]" : dataMode === "delayed" ? "text-amber-500" : "text-muted-foreground")}>
                {dataMode === "live" ? "Live" : dataMode === "delayed" ? "Rate-limited" : dataMode === "cached" ? "Cached" : "Demo"}
              </span>
              {" "}data
            </span>
            <span className="h-3 w-px bg-border" />
            <span>{counts.total} ideas · {counts.highConviction} high conviction</span>
          </div>
        </div>
        <RegimeCard bias={MOCK_REGIME.bias} spy={spyQ} qqq={qqqQ} smh={smhQ} />
      </div>

      <RefreshBar
        lastFullScanAt={lastFullScanAt}
        nextFullScanAt={nextFullScanAt}
        marketDataUpdatedAt={liveQuoteUpdatedAt}
        optionQuoteUpdatedAt={lastFullScanAt}
        dataMode={dataMode}
        autoRefresh={autoRefresh && fullScanIntervalMs > 0}
        isScanning={isScanning}
        onRunScanNow={onRunScanNow}
        onRefreshQuotesOnly={onRefreshQuotesOnly}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
      />

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
