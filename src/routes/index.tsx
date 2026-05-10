import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MOCK_CANDIDATES, MOCK_REGIME } from "@/lib/mockData";
import { CompactTradeCard } from "@/components/CompactTradeCard";
import { TradeDetailDrawer } from "@/components/TradeDetailDrawer";
import { RefreshBar } from "@/components/RefreshBar";
import { enrichWithPublicChain, type EnrichmentResult } from "@/lib/chain.functions";
import { getScannerSettingsFn } from "@/lib/massive.functions";
import type { Direction, Label, SetupType, TradeCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useRedditSentiment } from "@/hooks/useRedditSentiment";
import { useEarnings } from "@/hooks/useEarnings";
import { applyLiveChain, applyLiveQuote, applyRedditSignal, finalizeCandidate } from "@/lib/applyLiveQuote";
import { expirationBucketFor } from "@/lib/optionQualityValidator";
import { entryModeFromSetup } from "@/lib/entryMode";
import { chainPickKey } from "@/lib/chainKeys";
import { runDisciplineGate, type DisciplineGateResult } from "@/lib/disciplineGate";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — Momentum Options Scanner" }] }),
  component: Dashboard,
});

const LABEL_ORDER: Record<Label, number> = {
  "Buy Now": 0,
  "Watchlist": 1,
  "Waiting on Trigger": 2,
  "Aggressive": 3,
  "Lotto": 4,
  "Near Miss": 5,
  "Find Better Strike": 6,
  "Avoid Contract": 7,
  "Avoid Ticker": 8,
  "Avoid": 9,
};

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "bull" | "watch" | "warn" | "bear" }) {
  const cls =
    tone === "bull" ? "text-[var(--color-bull)]"
    : tone === "watch" ? "text-[var(--color-watch)]"
    : tone === "warn" ? "text-amber-500"
    : tone === "bear" ? "text-[var(--color-bear)]"
    : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums leading-none mt-1", cls)}>{value}</div>
    </div>
  );
}

function RegimeCard({
  bias, spy, qqq, smh, live,
}: {
  bias: string;
  spy: { price: number; changePct: number };
  qqq: { price: number; changePct: number };
  smh: { price: number; changePct: number };
  live: boolean;
}) {
  const biasCls =
    bias === "Risk-on" ? "text-[var(--color-bull)] bg-[var(--color-bull)]/10 border-[var(--color-bull)]/30"
    : bias === "Risk-off" ? "text-[var(--color-bear)] bg-[var(--color-bear)]/10 border-[var(--color-bear)]/30"
    : "text-[var(--color-watch)] bg-[var(--color-watch)]/10 border-[var(--color-watch)]/30";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Market Regime</span>
        <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-bold", biasCls)}>{bias}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[{ sym: "SPY", q: spy }, { sym: "QQQ", q: qqq }, { sym: "SMH", q: smh }].map(({ sym, q }) => (
          <div key={sym}>
            <div className="text-[10px] font-semibold text-muted-foreground">{sym}</div>
            <div className="mt-0.5 font-mono text-sm font-semibold">${q.price.toFixed(2)}</div>
            <div className={cn("font-mono text-[11px]", q.changePct >= 0 ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]")}>
              {q.changePct >= 0 ? "+" : ""}{q.changePct.toFixed(2)}%
            </div>
          </div>
        ))}
      </div>
      {!live && (
        <div className="mt-2 text-[10px] text-muted-foreground/60">Demo data</div>
      )}
    </div>
  );
}

function Dashboard() {
  const [dir, setDir] = useState<Direction | "ALL">("ALL");
  const [labelF, setLabelF] = useState<Label | "ALL">("ALL");
  const [setupF, setSetupF] = useState<SetupType | "ALL">("ALL");
  const [hideAvoids, setHideAvoids] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Tick once per second so the refresh bar's "Ns ago" / "in Ns" labels update.
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
  // Default 10 minutes. 0 = manual only.
  const fullScanIntervalMs = scannerSettings?.fullScanIntervalMs ?? 10 * 60_000;

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
    // Stability: keep the same contract picks across quote refreshes — only
    // a fresh full scan (manual or scheduled) replaces selected contracts.
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
      toast.warning("Rate limit hit", { description: chainData.message ?? "Showing demo data meanwhile.", duration: 6000 });
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
      return { c: merged, gate };
    });
  }, [chainData, getLive, getReddit]);

  const candidates = useMemo(() => traces.map((t) => t.c), [traces]);

  const setupOptions = useMemo(
    () => Array.from(new Set(MOCK_CANDIDATES.map((c) => c.setupType))) as SetupType[],
    [],
  );

  const filtered = useMemo(() => {
    const rows = candidates
      .filter((c) => dir === "ALL" || c.direction === dir)
      .filter((c) => labelF === "ALL" || c.label === labelF)
      .filter((c) => setupF === "ALL" || c.setupType === setupF)
      .filter((c) => !hideAvoids || c.label !== "Avoid Ticker");
    return rows.sort((a, b) => {
      const dl = (LABEL_ORDER[a.label] ?? 9) - (LABEL_ORDER[b.label] ?? 9);
      if (dl !== 0) return dl;
      const ta = a.triggerStatus === "active" ? 0 : 1;
      const tb = b.triggerStatus === "active" ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return (b.finalScore ?? b.score) - (a.finalScore ?? a.score);
    });
  }, [candidates, dir, labelF, setupF, hideAvoids]);

  const labelCounts = useMemo(() => {
    const out: Partial<Record<Label, number>> = {};
    for (const c of candidates) out[c.label] = (out[c.label] ?? 0) + 1;
    return out;
  }, [candidates]);

  const traceById = useMemo(() => {
    const m = new Map<string, { c: TradeCandidate; gate: DisciplineGateResult }>();
    for (const t of traces) m.set(t.c.id, t);
    return m;
  }, [traces]);
  const open = openId ? traceById.get(openId) ?? null : null;

  // Latest live-quote update timestamp (across all symbols).
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

  // Read regime quotes from cache (NavBar already fetches these).
  const regimeData = qc.getQueryData<{ live: boolean; quotes?: { SPY?: { price: number; changePct: number }; QQQ?: { price: number; changePct: number }; SMH?: { price: number; changePct: number } } }>(["regime-quotes"]);
  const regimeLive = regimeData?.live ?? false;
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Stable picks · full scan reranks {fullScanIntervalMs > 0 ? `every ${Math.round(fullScanIntervalMs / 60_000)} min` : "on demand"} · quotes refresh continuously
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className={cn("font-semibold", dataMode === "live" ? "text-[var(--color-bull)]" : dataMode === "delayed" ? "text-amber-500" : "text-muted-foreground")}>
                {dataMode === "live" ? "Live" : dataMode === "delayed" ? "Rate-limited" : dataMode === "cached" ? "Cached" : "Demo"}
              </span>
              {" "}data
            </span>
            <span className="h-3 w-px bg-border" />
            <span>{candidates.length} candidates · {labelCounts["Buy Now"] ?? 0} buy now</span>
          </div>
        </div>
        <RegimeCard bias={MOCK_REGIME.bias} spy={spyQ} qqq={qqqQ} smh={smhQ} live={regimeLive} />
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-9">
        <Stat label="Total" value={candidates.length} />
        <Stat label="Buy Now" value={labelCounts["Buy Now"] ?? 0} tone="bull" />
        <Stat label="Watchlist" value={labelCounts["Watchlist"] ?? 0} tone="watch" />
        <Stat label="On Trigger" value={labelCounts["Waiting on Trigger"] ?? 0} tone="watch" />
        <Stat label="Aggressive" value={labelCounts["Aggressive"] ?? 0} tone="warn" />
        <Stat label="Lotto" value={labelCounts["Lotto"] ?? 0} tone="warn" />
        <Stat label="Near Miss" value={labelCounts["Near Miss"] ?? 0} tone="warn" />
        <Stat label="Avoid Contract" value={labelCounts["Avoid Contract"] ?? 0} tone="bear" />
        <Stat label="Avoid Ticker" value={labelCounts["Avoid Ticker"] ?? 0} tone="bear" />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5">
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Dir</span>
          {(["ALL", "CALL", "PUT"] as const).map((d) => (
            <Pill key={d} active={dir === d} onClick={() => setDir(d)}>{d}</Pill>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Label</span>
          {(["ALL", "Buy Now", "Watchlist", "Waiting on Trigger", "Aggressive", "Lotto", "Near Miss", "Find Better Strike", "Avoid Contract"] as const).map((l) => (
            <Pill key={l} active={labelF === l} onClick={() => setLabelF(l as Label | "ALL")}>{l}</Pill>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Setup</span>
          <select
            value={setupF}
            onChange={(e) => setSetupF(e.target.value as SetupType | "ALL")}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="ALL">All setups</option>
            {setupOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={hideAvoids} onChange={(e) => setHideAvoids(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-bull)]" />
          Hide Ticker Avoids
        </label>
      </div>

      {/* Cards modern grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No clean trades match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => (
            <CompactTradeCard
              key={t.id}
              t={t}
              warnings={t.buyNowBlockers ?? []}
              onOpenDetails={() => setOpenId(t.id)}
            />
          ))}
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
