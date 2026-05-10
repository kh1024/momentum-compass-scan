import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutList, LayoutGrid, SlidersHorizontal, X } from "lucide-react";
import { buildUniverseCandidates } from "@/lib/mockData";
import { CompactTradeCard } from "@/components/CompactTradeCard";
import { TradeTable } from "@/components/TradeTable";
import { TradeDetailDrawer } from "@/components/TradeDetailDrawer";
import { RefreshBar } from "@/components/RefreshBar";
import { enrichWithPublicChain, type EnrichmentResult } from "@/lib/chain.functions";
import { getScannerSettingsFn } from "@/lib/massive.functions";
import type { CapBucket, Direction, Label, TradeCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useRedditSentiment } from "@/hooks/useRedditSentiment";
import { applyLiveChain, applyLiveQuote, applyRedditSignal, finalizeCandidate } from "@/lib/applyLiveQuote";
import { expirationBucketFor, EXPIRATION_BUCKET_LABEL } from "@/lib/optionQualityValidator";
import { entryModeFromSetup } from "@/lib/entryMode";
import { chainPickKey } from "@/lib/chainKeys";
import { runDisciplineGate, type DisciplineGateResult } from "@/lib/disciplineGate";
import {
  ALL_GROUPS, UNIVERSE_GROUPS, getActiveUniverse, loadGroupEnabled, saveGroupEnabled,
  type UniverseGroup,
} from "@/lib/universe";
import { loadScannerMode, saveScannerMode, type ScannerMode } from "@/lib/scannerMode";
import type { ExpirationBucket } from "@/lib/types";
import { LabelChip, ScoreBadge } from "@/components/Badges";

export const Route = createFileRoute("/scanner")({
  head: () => ({ meta: [{ title: "Scanner — Momentum Options Scanner" }] }),
  component: Scanner,
});

type ViewMode = "table" | "card";

const LABEL_ORDER: Record<Label, number> = {
  "Buy Now": 0, "Watchlist": 1, "Waiting on Trigger": 2, "Aggressive": 3,
  "Lotto": 4, "Near Miss": 5, "Find Better Strike": 6,
  "Avoid Contract": 7, "Avoid Ticker": 8, "Avoid": 9,
};

const TIER_LABELS: Label[] = [
  "Buy Now", "Watchlist", "Waiting on Trigger", "Aggressive",
  "Lotto", "Near Miss", "Find Better Strike", "Avoid Contract",
];

const TIER_COLORS: Partial<Record<Label, string>> = {
  "Buy Now":            "text-[var(--color-bull)]",
  "Watchlist":          "text-blue-400",
  "Waiting on Trigger": "text-sky-400",
  "Aggressive":         "text-[var(--color-watch)]",
  "Lotto":              "text-[var(--color-lotto)]",
  "Near Miss":          "text-fuchsia-400",
  "Find Better Strike": "text-orange-400",
  "Avoid Contract":     "text-orange-500",
  "Avoid Ticker":       "text-[var(--color-bear)]",
};

type DteBucketFilter = "ALL" | ExpirationBucket;

const DTE_OPTIONS: Array<[DteBucketFilter, string]> = [
  ["ALL", "All DTE"],
  ["weekly-lotto", "0–6d"],
  ["lotto-aggressive", "7–13d"],
  ["short-term-swing", "14–30d"],
  ["extended-swing", "31–45d"],
  ["swing-plus", "46–60d"],
  ["leaps", "180d+"],
];

const BUCKET_ORDER: ExpirationBucket[] = [
  "weekly-lotto", "lotto-aggressive", "short-term-swing",
  "extended-swing", "swing-plus", "leaps",
];

function Scanner() {
  // Universe
  const [universeEnabled, setUniverseEnabled] = useState<Record<UniverseGroup, boolean>>(() => ({
    MEGA_LARGE: loadGroupEnabled("MEGA_LARGE"),
    ETFS: loadGroupEnabled("ETFS"),
    MID_MOMENTUM: loadGroupEnabled("MID_MOMENTUM"),
    YOLO_REDDIT: loadGroupEnabled("YOLO_REDDIT"),
  }));
  function toggleGroup(g: UniverseGroup) {
    setUniverseEnabled((prev) => {
      const next = { ...prev, [g]: !prev[g] };
      saveGroupEnabled(g, next[g]);
      return next;
    });
  }

  // Mode
  const [scannerMode, setScannerModeState] = useState<ScannerMode>(() => loadScannerMode());
  function setMode(m: ScannerMode) { saveScannerMode(m); setScannerModeState(m); }

  // Filters
  const [dir, setDir] = useState<Direction | "ALL">("ALL");
  const [capFilter, setCapFilter] = useState<CapBucket | "ALL">("ALL");
  const [dteFilter, setDteFilter] = useState<DteBucketFilter>("ALL");
  const [maxCost, setMaxCost] = useState(1000);
  const [triggerActiveOnly, setTriggerActiveOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [hideTrueAvoids, setHideTrueAvoids] = useState(true);
  const [hiddenLabels, setHiddenLabels] = useState<Set<Label>>(new Set());
  const [includeLeaps, setIncludeLeaps] = useState(true);
  const [includeYolo, setIncludeYolo] = useState(true);
  const [extendedSwingEnabled, setExtendedSwingEnabled] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  function toggleLabel(lbl: Label) {
    setHiddenLabels((prev) => { const n = new Set(prev); n.has(lbl) ? n.delete(lbl) : n.add(lbl); return n; });
  }

  // UI
  const [view, setView] = useState<ViewMode>("table");
  const [openId, setOpenId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [, setNowTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  // Universe → candidates
  const activeTickers = useMemo(() => getActiveUniverse(universeEnabled), [universeEnabled]);
  const allMockCandidates = useMemo(() => buildUniverseCandidates(activeTickers), [activeTickers]);

  const qc = useQueryClient();
  const enrichFn = useServerFn(enrichWithPublicChain);
  const fetchScannerSettings = useServerFn(getScannerSettingsFn);
  const { data: scannerSettings } = useQuery({
    queryKey: ["scanner-settings"],
    queryFn: () => fetchScannerSettings(),
    staleTime: 60_000,
  });
  const fullScanIntervalMs = scannerSettings?.fullScanIntervalMs ?? 10 * 60_000;

  const picks = useMemo(
    () => allMockCandidates.map((c) => ({
      ticker: c.ticker, direction: c.direction,
      isLeaps: c.setupType === "LEAPS", isYolo: c.setupType === "Reddit YOLO",
      entryMode: entryModeFromSetup(c.setupType),
      targetStrike: entryModeFromSetup(c.setupType) === "Breakout" ? c.levels.baseHigh : c.price,
    })), [allMockCandidates],
  );

  const max = scannerSettings?.maxTickersPerScan ?? 12;
  const scanPicks = useMemo(() => picks.slice(0, max), [picks, max]);

  const { data: chainData, isFetching: isScanning, refetch: refetchChain, error: chainError, dataUpdatedAt } =
    useQuery<EnrichmentResult>({
      queryKey: ["scanner-chain", scanPicks.map((p) => `${p.ticker}:${p.direction}:${p.isLeaps?1:0}:${p.isYolo?1:0}:${p.entryMode}:${p.targetStrike}`).join(",")],
      queryFn: () => enrichFn({ data: { picks: scanPicks } }),
      enabled: scanPicks.length > 0,
      refetchInterval: autoRefresh && fullScanIntervalMs > 0 ? fullScanIntervalMs : false,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      staleTime: fullScanIntervalMs > 0 ? Math.max(fullScanIntervalMs - 10_000, 60_000) : 24 * 60 * 60_000,
      placeholderData: (prev) => prev,
    });

  const lastFullScanAt = dataUpdatedAt || null;
  const nextFullScanAt = autoRefresh && fullScanIntervalMs > 0 && lastFullScanAt ? lastFullScanAt + fullScanIntervalMs : null;
  const ageMs = dataUpdatedAt ? Date.now() - dataUpdatedAt : null;
  const isStale = ageMs != null && fullScanIntervalMs > 0 && ageMs > fullScanIntervalMs * 2;

  useEffect(() => {
    if (chainError) toast.error("Scan failed", { description: chainError instanceof Error ? chainError.message : String(chainError) });
  }, [chainError]);

  const lastRateLimitedRef = useRef(false);
  useEffect(() => {
    if (!chainData) return;
    const now = chainData.rateLimited;
    if (now && !lastRateLimitedRef.current) toast.warning("Rate limit hit", { description: "Showing demo data.", duration: 6000 });
    else if (!now && lastRateLimitedRef.current) toast.success("Live data restored");
    lastRateLimitedRef.current = now;
  }, [chainData]);

  const symbols = useMemo(() => Array.from(new Set(allMockCandidates.map((c) => c.ticker))), [allMockCandidates]);
  const { get: getLive, anyLive } = useLiveQuotes(symbols);
  const { get: getReddit } = useRedditSentiment(symbols);

  // Core trace pipeline
  const traces = useMemo(() => {
    const enriched = chainData?.enriched ?? {};
    return allMockCandidates.map((c) => {
      const isLeaps = c.setupType === "LEAPS";
      const isYolo = c.setupType === "Reddit YOLO";
      const base = applyRedditSignal(applyLiveQuote(c, getLive(c.ticker)), getReddit(c.ticker));
      const entryMode = entryModeFromSetup(c.setupType);
      const key = chainPickKey(c.ticker, c.direction, { isLeaps, isYolo, entryMode });
      const withChain = applyLiveChain(base, enriched[key] ?? null);
      const finalized = finalizeCandidate(withChain);
      const gate = runDisciplineGate(finalized, { extendedSwingEnabled, mode: scannerMode });
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
  }, [chainData, getLive, getReddit, extendedSwingEnabled, scannerMode, allMockCandidates]);

  const candidates = useMemo(() => traces.filter((t) => t.gate.visible).map((t) => t.c), [traces]);

  const labelCounts = useMemo(() => {
    const out: Partial<Record<Label, number>> = {};
    for (const c of candidates) out[c.label] = (out[c.label] ?? 0) + 1;
    return out;
  }, [candidates]);

  const totalScanned = allMockCandidates.length;
  const passedChart = traces.filter((t) => t.gate.visible).length;
  const activeGroupCount = ALL_GROUPS.filter((g) => universeEnabled[g]).length;

  const matchesDte = (dte: number, f: DteBucketFilter): boolean => f === "ALL" || expirationBucketFor(dte) === f;

  const filtered = useMemo(() => {
    return candidates
      .filter((c) => dir === "ALL" || c.direction === dir)
      .filter((c) => capFilter === "ALL" || c.cap === capFilter)
      .filter((c) => matchesDte(c.contract.dte, dteFilter))
      .filter((c) => c.contract.cost <= maxCost)
      .filter((c) => !triggerActiveOnly || c.triggerStatus === "active")
      .filter((c) => !verifiedOnly || c.contract.source === "chain")
      .filter((c) => !hideTrueAvoids || c.label !== "Avoid Ticker")
      .filter((c) => !hiddenLabels.has(c.label as Label))
      .filter((c) => includeLeaps || c.setupType !== "LEAPS")
      .filter((c) => includeYolo || c.setupType !== "Reddit YOLO")
      .sort((a, b) => {
        const dl = (LABEL_ORDER[a.label] ?? 9) - (LABEL_ORDER[b.label] ?? 9);
        if (dl !== 0) return dl;
        const ta = a.triggerStatus === "active" ? 0 : 1;
        const tb = b.triggerStatus === "active" ? 0 : 1;
        if (ta !== tb) return ta - tb;
        return (b.finalScore ?? b.score) - (a.finalScore ?? a.score);
      });
  }, [candidates, dir, capFilter, dteFilter, maxCost, triggerActiveOnly, verifiedOnly, hideTrueAvoids, hiddenLabels, includeLeaps, includeYolo]);

  const byBucket = useMemo(() => {
    const map = new Map<ExpirationBucket, TradeCandidate[]>();
    for (const c of filtered) {
      const b = (c.sectionRouted ?? expirationBucketFor(c.contract.dte)) as ExpirationBucket;
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(c);
    }
    return map;
  }, [filtered]);

  const traceById = useMemo(() => {
    const m = new Map<string, { c: TradeCandidate; gate: DisciplineGateResult }>();
    for (const t of traces) m.set(t.c.id, t);
    return m;
  }, [traces]);
  const open = openId ? traceById.get(openId) ?? null : null;

  const liveCount = chainData ? Object.values(chainData.enriched).filter((v) => v !== null).length : 0;
  const dataMode: "live" | "cached" | "delayed" | "demo" =
    chainData?.rateLimited ? "delayed"
    : chainData && Object.values(chainData.enriched).some((v) => v !== null) ? "live"
    : anyLive ? "cached"
    : "demo";

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      {/* ---- Page header ---- */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Scanner</h1>
          <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">
            {activeGroupCount} groups · {activeTickers.length} tickers · {totalScanned} candidates · {liveCount} live
            {isStale && <span className="ml-2 text-[var(--color-watch)]">⚠ stale</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-0.5">
            <ViewBtn active={view === "table"} onClick={() => setView("table")} icon={LayoutList} />
            <ViewBtn active={view === "card"} onClick={() => setView("card")} icon={LayoutGrid} />
          </div>
          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              showFilters
                ? "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/5 text-[var(--color-bull)]"
                : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </button>
        </div>
      </div>

      {/* ---- Stat strip ---- */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
        <span className="text-xs text-[var(--color-muted-foreground)]">
          <span className="font-semibold text-[var(--color-foreground)]">{passedChart}</span> passed ·{" "}
          <span className="font-semibold text-[var(--color-foreground)]">{filtered.length}</span> shown
        </span>
        <span className="h-3 w-px bg-[var(--color-border)]" />
        {TIER_LABELS.map((lbl) => {
          const count = labelCounts[lbl] ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={lbl}
              onClick={() => toggleLabel(lbl)}
              className={cn(
                "flex items-center gap-1 text-xs transition-opacity",
                hiddenLabels.has(lbl) ? "opacity-30" : "",
              )}
            >
              <span className={cn("font-bold tabular-nums", TIER_COLORS[lbl])}>{count}</span>
              <span className="text-[var(--color-muted-foreground)]">{lbl}</span>
            </button>
          );
        })}
      </div>

      {/* ---- Filter panel (collapsible) ---- */}
      {showFilters && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
            <span className="text-sm font-semibold">Filters</span>
            <button onClick={() => setShowFilters(false)}>
              <X className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* Universe */}
            <FilterSection title="Universe">
              {ALL_GROUPS.map((g) => (
                <Toggle key={g} active={universeEnabled[g]} onClick={() => toggleGroup(g)}>
                  {UNIVERSE_GROUPS[g].label}
                  <span className="ml-1 text-[10px] opacity-50">({UNIVERSE_GROUPS[g].tickers.length})</span>
                </Toggle>
              ))}
            </FilterSection>

            {/* Mode */}
            <FilterSection title="Scanner Mode">
              {(["Strict", "Balanced", "Discovery"] as ScannerMode[]).map((m) => (
                <Toggle key={m} active={scannerMode === m} onClick={() => setMode(m)}>{m}</Toggle>
              ))}
            </FilterSection>

            {/* Direction */}
            <FilterSection title="Direction">
              {(["ALL", "CALL", "PUT"] as const).map((v) => (
                <Toggle key={v} active={dir === v} onClick={() => setDir(v)}>
                  {v === "ALL" ? "All" : v === "CALL" ? "Calls" : "Puts"}
                </Toggle>
              ))}
            </FilterSection>

            {/* DTE */}
            <FilterSection title="DTE Bucket">
              {DTE_OPTIONS.map(([v, lbl]) => (
                <Toggle key={v} active={dteFilter === v} onClick={() => setDteFilter(v)}>{lbl}</Toggle>
              ))}
            </FilterSection>

            {/* Cap */}
            <FilterSection title="Market Cap">
              {(["ALL", "Mega", "Large", "Mid", "Small"] as const).map((v) => (
                <Toggle key={v} active={capFilter === v} onClick={() => setCapFilter(v)}>
                  {v === "ALL" ? "All" : v}
                </Toggle>
              ))}
            </FilterSection>

            {/* Max cost */}
            <FilterSection title={`Max cost: $${maxCost}`}>
              <input
                type="range" min={100} max={5000} step={100} value={maxCost}
                onChange={(e) => setMaxCost(+e.target.value)}
                className="w-full accent-[var(--color-bull)]"
              />
            </FilterSection>

            {/* Options */}
            <FilterSection title="Options">
              <Toggle active={!hideTrueAvoids} onClick={() => setHideTrueAvoids((v) => !v)}>Show Avoid Ticker</Toggle>
              <Toggle active={triggerActiveOnly} onClick={() => setTriggerActiveOnly((v) => !v)}>Trigger active only</Toggle>
              <Toggle active={verifiedOnly} onClick={() => setVerifiedOnly((v) => !v)}>Verified chain only</Toggle>
              <Toggle active={extendedSwingEnabled} onClick={() => setExtendedSwingEnabled((v) => !v)}>Extended Swing</Toggle>
              <Toggle active={includeLeaps} onClick={() => setIncludeLeaps((v) => !v)}>Include LEAPS</Toggle>
              <Toggle active={includeYolo} onClick={() => setIncludeYolo((v) => !v)}>Include YOLO</Toggle>
            </FilterSection>
          </div>
        </div>
      )}

      {/* ---- Refresh bar ---- */}
      <RefreshBar
        lastFullScanAt={lastFullScanAt}
        nextFullScanAt={nextFullScanAt}
        marketDataUpdatedAt={lastFullScanAt}
        optionQuoteUpdatedAt={lastFullScanAt}
        dataMode={dataMode}
        autoRefresh={autoRefresh && fullScanIntervalMs > 0}
        isScanning={isScanning}
        onRunScanNow={() => void refetchChain()}
        onRefreshQuotesOnly={() => { void qc.invalidateQueries({ queryKey: ["live-quotes"] }); toast.success("Refreshing quotes…"); }}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
      />

      {/* ---- Main content ---- */}
      {filtered.length === 0 ? (
        <EmptyState onClear={() => { setDir("ALL"); setCapFilter("ALL"); setDteFilter("ALL"); setHiddenLabels(new Set()); setHideTrueAvoids(false); }} />
      ) : view === "table" ? (
        <TradeTable rows={filtered} onOpen={setOpenId} />
      ) : (
        <div className="space-y-8">
          {BUCKET_ORDER.map((bucket) => {
            const rows = byBucket.get(bucket);
            if (!rows?.length) return null;
            return (
              <section key={bucket}>
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
                    {EXPIRATION_BUCKET_LABEL[bucket]}
                  </h2>
                  <span className="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-muted-foreground)]">
                    {rows.length}
                  </span>
                  <div className="h-px flex-1 bg-[var(--color-border)]" />
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {rows.map((t) => (
                    <CompactTradeCard
                      key={t.id}
                      t={t}
                      warnings={t.buyNowBlockers ?? []}
                      onOpenDetails={() => setOpenId(t.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <TradeDetailDrawer
        open={openId !== null}
        onOpenChange={(v) => !v && setOpenId(null)}
        t={open?.c ?? null}
        gate={open?.gate ?? null}
      />
    </div>
  );
}

// ---- Sub-components ---------------------------------------------------------

function ViewBtn({ active, onClick, icon: Icon }: { active: boolean; onClick: () => void; icon: React.ElementType }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center rounded-md p-1.5 transition-colors",
        active
          ? "bg-[var(--color-accent)] text-[var(--color-foreground)]"
          : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
          : "border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-[var(--color-border)] py-20">
      <p className="text-base font-medium text-[var(--color-muted-foreground)]">No candidates match your filters.</p>
      <p className="text-sm text-[var(--color-muted-foreground)]">A good scanner can say: no clean trades today.</p>
      <button onClick={onClear} className="text-sm text-[var(--color-bull)] underline-offset-2 hover:underline">
        Clear all filters
      </button>
    </div>
  );
}
