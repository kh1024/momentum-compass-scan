import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";
import { MOCK_CANDIDATES } from "@/lib/mockData";
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
import { LabelChip } from "@/components/Badges";
import { MOCK_REGIME } from "@/lib/mockData";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — Momentum Scanner" }] }),
  component: Dashboard,
});

const LABEL_ORDER: Record<Label, number> = {
  "Buy Now": 0, "Watchlist": 1, "Waiting on Trigger": 2, "Aggressive": 3,
  "Lotto": 4, "Near Miss": 5, "Find Better Strike": 6,
  "Avoid Contract": 7, "Avoid Ticker": 8, "Avoid": 9,
};

const STAT_LABELS: Array<{ label: Label | "ALL"; display: string; color: string }> = [
  { label: "Buy Now", display: "Buy Now", color: "text-[var(--color-bull)]" },
  { label: "Watchlist", display: "Watchlist", color: "text-blue-400" },
  { label: "Waiting on Trigger", display: "On Trigger", color: "text-sky-400" },
  { label: "Aggressive", display: "Aggressive", color: "text-[var(--color-watch)]" },
  { label: "Lotto", display: "Lotto", color: "text-[var(--color-lotto)]" },
  { label: "Near Miss", display: "Near Miss", color: "text-fuchsia-400" },
  { label: "Avoid Contract", display: "Avoid Contract", color: "text-orange-500" },
  { label: "Avoid Ticker", display: "Avoid Ticker", color: "text-[var(--color-bear)]" },
];

function RegimePill({ bias }: { bias: string }) {
  const { text, bg, icon: Icon } =
    bias === "Risk-on"  ? { text: "text-[var(--color-bull)]",  bg: "bg-[var(--color-bull)]/10",  icon: TrendingUp }
    : bias === "Risk-off" ? { text: "text-[var(--color-bear)]",  bg: "bg-[var(--color-bear)]/10",  icon: TrendingDown }
    : { text: "text-[var(--color-watch)]", bg: "bg-[var(--color-watch)]/10", icon: Minus };
  return (
    <span className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", bg, text)}>
      <Icon className="h-3.5 w-3.5" />
      {bias}
    </span>
  );
}

function Dashboard() {
  const [dir, setDir] = useState<Direction | "ALL">("ALL");
  const [labelF, setLabelF] = useState<Label | "ALL">("ALL");
  const [setupF, setSetupF] = useState<SetupType | "ALL">("ALL");
  const [hideAvoids, setHideAvoids] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
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
  const fullScanIntervalMs = scannerSettings?.fullScanIntervalMs ?? 10 * 60_000;

  const picks = useMemo(
    () => MOCK_CANDIDATES.map((c) => ({
      ticker: c.ticker, direction: c.direction,
      isLeaps: c.setupType === "LEAPS", isYolo: c.setupType === "Reddit YOLO",
      entryMode: entryModeFromSetup(c.setupType),
      targetStrike: entryModeFromSetup(c.setupType) === "Breakout" ? c.levels.baseHigh : c.price,
    })), [],
  );

  const { data: chainData, isFetching: isScanning, refetch: refetchChain, error: chainError, dataUpdatedAt } =
    useQuery<EnrichmentResult>({
      queryKey: ["dashboard-chain", picks.map((p) => `${p.ticker}:${p.direction}`).join(",")],
      queryFn: () => enrichFn({ data: { picks } }),
      enabled: picks.length > 0,
      refetchInterval: autoRefresh && fullScanIntervalMs > 0 ? fullScanIntervalMs : false,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
      staleTime: fullScanIntervalMs > 0 ? Math.max(fullScanIntervalMs - 10_000, 60_000) : 24 * 60 * 60_000,
      placeholderData: (prev) => prev,
    });

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
  const setupOptions = useMemo(() => Array.from(new Set(MOCK_CANDIDATES.map((c) => c.setupType))) as SetupType[], []);

  const filtered = useMemo(() => {
    return candidates
      .filter((c) => dir === "ALL" || c.direction === dir)
      .filter((c) => labelF === "ALL" || c.label === labelF)
      .filter((c) => setupF === "ALL" || c.setupType === setupF)
      .filter((c) => !hideAvoids || c.label !== "Avoid Ticker")
      .sort((a, b) => {
        const dl = (LABEL_ORDER[a.label] ?? 9) - (LABEL_ORDER[b.label] ?? 9);
        if (dl !== 0) return dl;
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

  const liveQuoteUpdatedAt = useMemo(() => {
    let max = 0;
    for (const s of symbols) { const q = getLive(s); if (q?.ts) max = Math.max(max, q.ts); }
    return max || null;
  }, [symbols, getLive]);

  const lastFullScanAt = dataUpdatedAt || null;
  const nextFullScanAt = autoRefresh && fullScanIntervalMs > 0 && lastFullScanAt ? lastFullScanAt + fullScanIntervalMs : null;
  const dataMode: "live" | "cached" | "delayed" | "demo" =
    chainData?.rateLimited ? "delayed"
    : anyLive && chainData?.enriched && Object.values(chainData.enriched).some((v) => v !== null) ? "live"
    : anyLive ? "cached"
    : "demo";

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {MOCK_REGIME.scannerBias} · Full scan every {Math.round(fullScanIntervalMs / 60_000)}m
          </p>
        </div>
        <RegimePill bias={MOCK_REGIME.bias} />
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
        {STAT_LABELS.map(({ label, display, color }) => (
          <button
            key={label}
            onClick={() => setLabelF(labelF === label ? "ALL" : label as Label)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-colors",
              labelF === label
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                : "border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)]/30",
            )}
          >
            <span className={cn("text-xl font-bold tabular-nums", color)}>
              {labelCounts[label as Label] ?? 0}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {display}
            </span>
          </button>
        ))}
      </div>

      {/* Refresh bar */}
      <RefreshBar
        lastFullScanAt={lastFullScanAt}
        nextFullScanAt={nextFullScanAt}
        marketDataUpdatedAt={liveQuoteUpdatedAt}
        optionQuoteUpdatedAt={lastFullScanAt}
        dataMode={dataMode}
        autoRefresh={autoRefresh && fullScanIntervalMs > 0}
        isScanning={isScanning}
        onRunScanNow={() => void refetchChain()}
        onRefreshQuotesOnly={() => { void qc.invalidateQueries({ queryKey: ["live-quotes"] }); toast.success("Refreshing quotes…"); }}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5">
        <FilterGroup label="Dir">
          {(["ALL", "CALL", "PUT"] as const).map((d) => (
            <FilterPill key={d} active={dir === d} onClick={() => setDir(d)}>{d}</FilterPill>
          ))}
        </FilterGroup>

        <div className="h-4 w-px bg-[var(--color-border)]" />

        <FilterGroup label="Setup">
          <select
            value={setupF}
            onChange={(e) => setSetupF(e.target.value as SetupType | "ALL")}
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-0.5 text-xs text-[var(--color-foreground)]"
          >
            <option value="ALL">All setups</option>
            {setupOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </FilterGroup>

        <div className="ml-auto flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
            <input
              type="checkbox"
              checked={hideAvoids}
              onChange={(e) => setHideAvoids(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-bull)]"
            />
            Hide avoids
          </label>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {filtered.length} of {candidates.length}
          </span>
        </div>
      </div>

      {/* Trade cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] py-16">
          <BarChart3 className="h-8 w-8 text-[var(--color-muted-foreground)]" />
          <p className="text-sm text-[var(--color-muted-foreground)]">No candidates match your filters.</p>
          <button onClick={() => { setDir("ALL"); setLabelF("ALL"); setSetupF("ALL"); setHideAvoids(false); }}
            className="text-xs text-[var(--color-bull)] underline-offset-2 hover:underline">
            Clear filters
          </button>
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

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">{label}</span>
      {children}
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors",
        active
          ? "border-[var(--color-bull)]/50 bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
          : "border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
      )}
    >
      {children}
    </button>
  );
}
