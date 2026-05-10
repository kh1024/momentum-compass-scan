import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
// useRef kept for rate-limit toast dedup; useEffect for chain error toast
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { buildUniverseCandidates } from "@/lib/mockData";
import { CompactTradeCard } from "@/components/CompactTradeCard";
import { TradeTable } from "@/components/TradeTable";
import { TradeDetailDrawer } from "@/components/TradeDetailDrawer";
import { ScanBar } from "@/components/ScanBar";
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

export const Route = createFileRoute("/scanner")({
  head: () => ({ meta: [{ title: "Scanner Results — Momentum Options Scanner" }] }),
  component: Scanner,
});

type ViewMode = "table" | "card";
type DteBucketFilter = "ALL" | "7day" | "weekly-lotto" | "lotto-aggressive" | "short-term-swing" | "extended-swing" | "swing-plus" | "leaps";

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

const ALL_TIER_LABELS: Label[] = [
  "Buy Now", "Watchlist", "Aggressive",
  "Lotto", "Near Miss", "Find Better Strike", "Avoid Contract",
];

const DTE_FILTER_OPTIONS: Array<[DteBucketFilter, string]> = [
  ["ALL", "All"],
  ["7day", "🗓️ 7-Day (4–10D)"],
  ["weekly-lotto", "0–6D"],
  ["lotto-aggressive", "7–13D"],
  ["short-term-swing", "14–30D"],
  ["extended-swing", "31–45D"],
  ["swing-plus", "46–60D"],
  ["leaps", "180D+"],
];

function Scanner() {
  // ---- Universe toggles (loaded from localStorage on mount) ----------------
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

  // ---- Scanner mode --------------------------------------------------------
  const [scannerMode, setScannerModeState] = useState<ScannerMode>(() => loadScannerMode());
  function setMode(m: ScannerMode) {
    saveScannerMode(m);
    setScannerModeState(m);
  }

  // ---- Filter state --------------------------------------------------------
  const [dir, setDir] = useState<Direction | "ALL">("ALL");
  const [capFilter, setCapFilter] = useState<CapBucket | "ALL">("ALL");
  const [dteFilter, setDteFilter] = useState<DteBucketFilter>("ALL");
  const [maxCost, setMaxCost] = useState(1000);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [hideTrueAvoids, setHideTrueAvoids] = useState(true);
  const [hiddenLabels, setHiddenLabels] = useState<Set<Label>>(new Set());
  const [includeLeaps, setIncludeLeaps] = useState(true);
  const [includeYolo, setIncludeYolo] = useState(true);
  const [extendedSwingEnabled, setExtendedSwingEnabled] = useState(true);

  function toggleLabelVisibility(lbl: Label) {
    setHiddenLabels((prev) => {
      const next = new Set(prev);
      if (next.has(lbl)) next.delete(lbl); else next.add(lbl);
      return next;
    });
  }

  // ---- View ----------------------------------------------------------------
  const [view, setView] = useState<ViewMode>("table");
  const [openId, setOpenId] = useState<string | null>(null);
  const [scanLimit, setScanLimit] = useState(30);
  type Preset = "all" | "lottos" | "reddit" | "leaps" | "buynow" | "aggressive" | "watchlist";
  const [preset, setPreset] = useState<Preset>("all");

  function applyPreset(p: Preset) {
    setPreset(p);
    // Reset narrow filters first
    setHiddenLabels(new Set());
    setIncludeLeaps(true);
    setIncludeYolo(true);
    setHideTrueAvoids(true);
    setDir("ALL");
    setCapFilter("ALL");
    setDteFilter("ALL");
    setMaxCost(5000);
    if (p === "lottos") {
      setHiddenLabels(new Set<Label>(["Buy Now", "Watchlist", "Waiting on Trigger", "Near Miss", "Find Better Strike", "Avoid Contract", "Avoid Ticker", "Avoid"]));
      setDteFilter("weekly-lotto");
    } else if (p === "reddit") {
      setIncludeLeaps(false);
      // YOLO universe must be on
      if (!universeEnabled.YOLO_REDDIT) toggleGroup("YOLO_REDDIT");
    } else if (p === "leaps") {
      setIncludeYolo(false);
      setDteFilter("leaps");
    } else if (p === "buynow") {
      setHiddenLabels(new Set<Label>(["Watchlist", "Waiting on Trigger", "Aggressive", "Lotto", "Near Miss", "Find Better Strike", "Avoid Contract", "Avoid Ticker", "Avoid"]));
    } else if (p === "aggressive") {
      setHiddenLabels(new Set<Label>(["Buy Now", "Watchlist", "Waiting on Trigger", "Lotto", "Near Miss", "Find Better Strike", "Avoid Contract", "Avoid Ticker", "Avoid"]));
    } else if (p === "watchlist") {
      setHiddenLabels(new Set<Label>(["Buy Now", "Aggressive", "Lotto", "Near Miss", "Find Better Strike", "Avoid Contract", "Avoid Ticker", "Avoid"]));
    }
  }


  // ---- Active universe → candidates ----------------------------------------
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
    () =>
      allMockCandidates.map((c) => ({
        ticker: c.ticker,
        direction: c.direction,
        isLeaps: c.setupType === "LEAPS",
        isYolo: c.setupType === "Reddit YOLO",
        entryMode: entryModeFromSetup(c.setupType),
        targetStrike: entryModeFromSetup(c.setupType) === "Breakout" ? c.levels.baseHigh : c.price,
      })),
    [allMockCandidates],
  );

  const max = Math.min(scanLimit, scannerSettings?.maxTickersPerScan ?? 50);
  const scanPicks = useMemo(() => picks.slice(0, max), [picks, max]);

  const {
    data: chainData,
    isFetching: isScanning,
    refetch: refetchChain,
    error: chainError,
    dataUpdatedAt,
  } = useQuery<EnrichmentResult>({
    queryKey: ["scanner-chain", scanPicks.map((p) => `${p.ticker}:${p.direction}:${p.isLeaps?1:0}:${p.isYolo?1:0}:${p.entryMode ?? ""}:${p.targetStrike ?? ""}`).join(",")],
    queryFn: () => enrichFn({ data: { picks: scanPicks } }),
    enabled: scanPicks.length > 0,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 60 * 60_000, // 1 hour — results are stable until you re-scan
    placeholderData: (previousData) => previousData,
  });

  const lastFullScanAt = dataUpdatedAt || null;

  useEffect(() => {
    if (chainError) {
      toast.error("Scanner request failed", {
        description: chainError instanceof Error ? chainError.message : String(chainError),
      });
    }
  }, [chainError]);

  const runScan = () => { void refetchChain(); };
  void fullScanIntervalMs;

  const lastRateLimitedRef = useRef(false);
  useEffect(() => {
    if (!chainData) return;
    const now = chainData.rateLimited;
    if (now && !lastRateLimitedRef.current) {
      toast.warning("Public.com rate limit hit", {
        description:
          chainData.message ??
          `Backing off for ${Math.ceil(chainData.retryInMs / 1000)}s. Showing demo data meanwhile.`,
        duration: 6000,
      });
    } else if (!now && lastRateLimitedRef.current) {
      toast.success("Public.com live data restored");
    }
    lastRateLimitedRef.current = now;
  }, [chainData]);

  const symbols = useMemo(
    () => Array.from(new Set(allMockCandidates.map((c) => c.ticker))),
    [allMockCandidates],
  );
  const { get: getLive, anyLive } = useLiveQuotes(symbols);
  const { get: getReddit } = useRedditSentiment(symbols);

  // ---- Core trace pipeline -------------------------------------------------
  const traces: { c: TradeCandidate; gate: DisciplineGateResult }[] = useMemo(() => {
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

  const candidates = useMemo(
    () => traces.filter((t) => t.gate.visible).map((t) => t.c),
    [traces],
  );

  // ---- Counts for stat bar -------------------------------------------------
  const labelCounts = useMemo(() => {
    const out: Partial<Record<Label, number>> = {};
    for (const c of candidates) out[c.label] = (out[c.label] ?? 0) + 1;
    return out;
  }, [candidates]);

  const totalScanned = allMockCandidates.length;
  const passedChart = traces.filter((t) => t.gate.visible).length;
  const failedContract = traces.filter(
    (t) => t.gate.visible && (t.gate.finalLabel === "Avoid Contract" || t.gate.finalLabel === "Find Better Strike"),
  ).length;
  const activeGroupCount = ALL_GROUPS.filter((g) => universeEnabled[g]).length;

  // ---- DTE filter ----------------------------------------------------------
  const matchesDte = (dte: number, f: DteBucketFilter): boolean => {
    if (f === "ALL") return true;
    return expirationBucketFor(dte) === f;
  };

  // ---- Filtered & sorted rows ----------------------------------------------
  const filtered = useMemo(() => {
    const rows = candidates
      .filter((c) => dir === "ALL" || c.direction === dir)
      .filter((c) => capFilter === "ALL" || c.cap === capFilter)
      .filter((c) => matchesDte(c.contract.dte, dteFilter))
      .filter((c) => c.contract.cost <= maxCost)
      .filter((c) => !verifiedOnly || c.contract.source === "chain")
      .filter((c) => !hideTrueAvoids || c.label !== "Avoid Ticker")
      .filter((c) => !hiddenLabels.has(c.label as Label))
      .filter((c) => includeLeaps || c.setupType !== "LEAPS")
      .filter((c) => includeYolo || c.setupType !== "Reddit YOLO");
    return rows.sort((a, b) => {
      const dl = (LABEL_ORDER[a.label] ?? 9) - (LABEL_ORDER[b.label] ?? 9);
      if (dl !== 0) return dl;
      return (b.finalScore ?? b.score) - (a.finalScore ?? a.score);
    });
  }, [candidates, dir, capFilter, dteFilter, maxCost, verifiedOnly, hideTrueAvoids, hiddenLabels, includeLeaps, includeYolo]);

  // ---- DTE-bucketed groups for sectioned view ------------------------------
  const BUCKET_ORDER: ExpirationBucket[] = [
    "weekly-lotto", "lotto-aggressive", "short-term-swing",
    "extended-swing", "swing-plus", "leaps",
  ];

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

  const liveCount = chainData
    ? Object.values(chainData.enriched).filter((v) => v !== null).length
    : 0;

  void getLive;
  const dataMode: "live" | "cached" | "delayed" | "demo" =
    chainData?.rateLimited ? "delayed"
    : chainData && Object.values(chainData.enriched).some((v) => v !== null) ? "live"
    : anyLive ? "cached"
    : "demo";

  return (
    <div className="space-y-4">
      {/* ---- Header -------------------------------------------------------- */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Scanner</h1>
          <p className="text-xs text-muted-foreground">
            {liveCount}/{scanPicks.length} live contracts · Regime: <span className="text-foreground">Risk-on</span>
          </p>
        </div>
      </div>

      <ScanBar
        lastScanAt={lastFullScanAt}
        dataMode={dataMode}
        isScanning={isScanning}
        onRunScan={runScan}
      />

      {/* ---- Stat bar ------------------------------------------------------ */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="font-semibold text-foreground mono">{totalScanned}</span> scanned ·
            <span className="font-semibold text-foreground mono">{passedChart}</span> passed ·
            <span className="font-semibold text-foreground mono">{failedContract}</span> failed contract ·
            <span className="text-muted-foreground">{activeGroupCount}/4 groups · {activeTickers.length} tickers</span>
          </span>
          <span className="h-3 w-px bg-border" />
          <Stat label="Buy Now" value={labelCounts["Buy Now"] ?? 0} tone="bull" />
          <Stat label="Watchlist" value={((labelCounts["Watchlist"] ?? 0) + (labelCounts["Waiting on Trigger"] ?? 0))} tone="watch" />
          <Stat label="Aggressive" value={labelCounts["Aggressive"] ?? 0} tone="warn" />
          <Stat label="Lotto" value={labelCounts["Lotto"] ?? 0} tone="warn" />
          <Stat label="Near Miss" value={labelCounts["Near Miss"] ?? 0} tone="fuchsia" />
          <Stat label="Find Better" value={labelCounts["Find Better Strike"] ?? 0} tone="amber" />
          <Stat label="Avoid Contract" value={labelCounts["Avoid Contract"] ?? 0} tone="orange" />
          <Stat label="Avoid Ticker" value={labelCounts["Avoid Ticker"] ?? 0} tone="bear" />
        </div>
      </div>

      {/* ---- Quick presets ------------------------------------------------- */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <Group label="Quick picks">
            <Chip active={preset === "all"} onClick={() => applyPreset("all")}>All</Chip>
            <Chip active={preset === "buynow"} onClick={() => applyPreset("buynow")}>🔥 Buy Now</Chip>
            <Chip active={preset === "watchlist"} onClick={() => applyPreset("watchlist")}>👀 Watchlist</Chip>
            <Chip active={preset === "aggressive"} onClick={() => applyPreset("aggressive")}>⚡ Aggressive</Chip>
            <Chip active={preset === "lottos"} onClick={() => applyPreset("lottos")}>🎰 Lottos</Chip>
            <Chip active={preset === "reddit"} onClick={() => applyPreset("reddit")}>🚀 Reddit YOLO</Chip>
            <Chip active={preset === "leaps"} onClick={() => applyPreset("leaps")}>📅 LEAPS</Chip>
          </Group>
          <Group label={`Scan size: ${max}`}>
            <input
              type="range" min={10} max={50} step={5} value={scanLimit}
              onChange={(e) => setScanLimit(+e.target.value)}
              className="w-32 accent-[var(--color-bull)]"
            />
          </Group>
        </div>
      </div>

      {/* ---- Filter bar ---------------------------------------------------- */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">

          {/* Universe groups */}
          <Group label="Universe">
            {ALL_GROUPS.map((g) => (
              <Chip
                key={g}
                active={universeEnabled[g]}
                onClick={() => toggleGroup(g)}
              >
                {UNIVERSE_GROUPS[g].label}
              </Chip>
            ))}
          </Group>

          {/* Scanner mode */}
          <Group label="Mode">
            {(["Strict", "Balanced", "Discovery"] as ScannerMode[]).map((m) => (
              <Chip key={m} active={scannerMode === m} onClick={() => setMode(m)}>{m}</Chip>
            ))}
          </Group>

          {/* Direction */}
          <Group label="Direction">
            {(["ALL", "CALL", "PUT"] as const).map((v) => (
              <Chip key={v} active={dir === v} onClick={() => setDir(v)}>
                {v === "ALL" ? "All" : v === "CALL" ? "Calls" : "Puts"}
              </Chip>
            ))}
          </Group>

          {/* Cap */}
          <Group label="Cap">
            {(["ALL", "Mega", "Large", "Mid", "Small"] as const).map((v) => (
              <Chip key={v} active={capFilter === v} onClick={() => setCapFilter(v)}>
                {v === "ALL" ? "All" : v}
              </Chip>
            ))}
          </Group>

          {/* DTE */}
          <Group label="DTE">
            {DTE_FILTER_OPTIONS.map(([v, lbl]) => (
              <Chip key={v} active={dteFilter === v} onClick={() => setDteFilter(v)}>{lbl}</Chip>
            ))}
          </Group>

          {/* Max cost */}
          <Group label={`Max cost: $${maxCost}`}>
            <input
              type="range" min={100} max={5000} step={100} value={maxCost}
              onChange={(e) => setMaxCost(+e.target.value)}
              className="w-32 accent-[var(--color-bull)]"
            />
          </Group>

          {/* Tier visibility */}
          <Group label="Show tiers">
            {ALL_TIER_LABELS.map((lbl) => (
              <Chip key={lbl} active={!hiddenLabels.has(lbl)} onClick={() => toggleLabelVisibility(lbl)}>
                {lbl}
              </Chip>
            ))}
          </Group>

          {/* Misc toggles */}
          <Group label="Toggles">
            <Chip active={hideTrueAvoids} onClick={() => setHideTrueAvoids((v) => !v)}>Hide Ticker Avoids</Chip>
            <Chip active={verifiedOnly} onClick={() => setVerifiedOnly((v) => !v)}>Verified only</Chip>
            <Chip active={includeLeaps} onClick={() => setIncludeLeaps((v) => !v)}>LEAPS</Chip>
            <Chip active={includeYolo} onClick={() => setIncludeYolo((v) => !v)}>YOLO</Chip>
            <Chip active={extendedSwingEnabled} onClick={() => setExtendedSwingEnabled((v) => !v)}>Extended Swing</Chip>
          </Group>

          {/* View */}
          <Group label="View">
            <Chip active={view === "table"} onClick={() => setView("table")}>Table</Chip>
            <Chip active={view === "card"} onClick={() => setView("card")}>Cards</Chip>
          </Group>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">{filtered.length} candidates shown</div>

      {/* ---- Main content — flat vs DTE-sectioned -------------------------- */}
      {view === "table" ? (
        <TradeTable rows={filtered} onOpen={setOpenId} isLoading={isScanning && filtered.length === 0} />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 py-14 text-center">
          <div className="text-2xl text-muted-foreground/20">—</div>
          <div className="mt-2 text-sm font-medium text-muted-foreground">No candidates match current filters</div>
          <div className="mt-1 text-xs text-muted-foreground/60">Try relaxing DTE, direction, or label filters</div>
        </div>
      ) : (
        <div className="space-y-6">
          {BUCKET_ORDER.map((bucket) => {
            const rows = byBucket.get(bucket);
            if (!rows || rows.length === 0) return null;
            return (
              <div key={bucket} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {EXPIRATION_BUCKET_LABEL[bucket]}
                  </h2>
                  <span className="text-[10px] text-muted-foreground">({rows.length})</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {rows.map((t) => (
                    <CompactTradeCard
                      key={t.id}
                      t={t}
                      warnings={t.buyNowBlockers ?? []}
                      onOpenDetails={() => setOpenId(t.id)}
                    />
                  ))}
                </div>
              </div>
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

// ---- Small helpers ---------------------------------------------------------

type StatTone = "bull" | "watch" | "sky" | "warn" | "fuchsia" | "amber" | "orange" | "bear";

function Stat({ label, value, tone }: { label: string; value: number; tone?: StatTone }) {
  const cls =
    tone === "bull"    ? "text-[var(--color-bull)]"
    : tone === "watch"   ? "text-[var(--color-watch)]"
    : tone === "sky"     ? "text-sky-400"
    : tone === "warn"    ? "text-amber-500"
    : tone === "fuchsia" ? "text-fuchsia-400"
    : tone === "amber"   ? "text-amber-500"
    : tone === "orange"  ? "text-orange-400"
    : tone === "bear"    ? "text-[var(--color-bear)]"
    : "text-foreground";
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("font-semibold mono", cls)}>{value}</span>
    </span>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
        active
          ? "border-[var(--color-bull)] bg-[var(--color-bull)]/15 text-[var(--color-bull)]"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
