import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MOCK_CANDIDATES } from "@/lib/mockData";
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
import { expirationBucketFor } from "@/lib/optionQualityValidator";
import { entryModeFromSetup } from "@/lib/entryMode";
import { chainPickKey } from "@/lib/chainKeys";
import { runDisciplineGate, type DisciplineGateResult } from "@/lib/disciplineGate";

export const Route = createFileRoute("/scanner")({
  head: () => ({ meta: [{ title: "Scanner Results — Momentum Options Scanner" }] }),
  component: Scanner,
});

type ViewMode = "table" | "card";
type Persona = "trader" | "debug";
type DteBucketFilter = "ALL" | "weekly" | "short" | "extended" | "leaps";

const LABEL_ORDER: Record<Label, number> = {
  "Buy Now": 0, "Watchlist": 1, "Aggressive": 2, "Lotto": 3, "Find Better Strike": 4, "Avoid": 5,
};


function Scanner() {
  const [dir, setDir] = useState<Direction | "ALL">("ALL");
  const [label, setLabel] = useState<Label | "ALL">("ALL");
  const [capFilter, setCapFilter] = useState<CapBucket | "ALL">("ALL");
  const [dteFilter, setDteFilter] = useState<DteBucketFilter>("ALL");
  const [maxCost, setMaxCost] = useState(1000);
  const [triggerActiveOnly, setTriggerActiveOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [hideAvoids, setHideAvoids] = useState(true);
  const [includeLeaps, setIncludeLeaps] = useState(true);
  const [includeYolo, setIncludeYolo] = useState(true);
  const [extendedSwingEnabled, setExtendedSwingEnabled] = useState(true);
  const [view, setView] = useState<ViewMode>("table");
  const [persona, setPersona] = useState<Persona>("trader");
  const [openId, setOpenId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  // Tick every 1s so the "updated Ns ago" / next-scan clock re-renders.
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
  const max = scannerSettings?.maxTickersPerScan ?? 12;
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
    refetchInterval: autoRefresh && fullScanIntervalMs > 0 ? fullScanIntervalMs : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    // Stability: keep selected contracts steady between full scans.
    staleTime: fullScanIntervalMs > 0 ? Math.max(fullScanIntervalMs - 10_000, 60_000) : 24 * 60 * 60_000,
    placeholderData: (previousData) => previousData,
  });
  const lastFullScanAt = dataUpdatedAt || null;
  const nextFullScanAt =
    autoRefresh && fullScanIntervalMs > 0 && lastFullScanAt
      ? lastFullScanAt + fullScanIntervalMs
      : null;
  const ageMs = dataUpdatedAt ? Date.now() - dataUpdatedAt : null;
  const isStale = ageMs != null && fullScanIntervalMs > 0 && ageMs > fullScanIntervalMs * 2;
  useEffect(() => {
    if (chainError) {
      toast.error("Scanner request failed", {
        description: chainError instanceof Error ? chainError.message : String(chainError),
      });
    }
  }, [chainError]);
  const runScan = () => { void refetchChain(); };

  // User-friendly toast on rate-limit transitions.
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
    () => Array.from(new Set(MOCK_CANDIDATES.map((c) => c.ticker))),
    [],
  );
  const { get: getLive, anyLive } = useLiveQuotes(symbols);
  const { get: getReddit } = useRedditSentiment(symbols);

  const traces: { c: TradeCandidate; gate: DisciplineGateResult }[] = useMemo(() => {
    const enriched = chainData?.enriched ?? {};
    return MOCK_CANDIDATES.map((c) => {
      const isLeaps = c.setupType === "LEAPS";
      const isYolo = c.setupType === "Reddit YOLO";
      const base = applyRedditSignal(applyLiveQuote(c, getLive(c.ticker)), getReddit(c.ticker));
      const entryMode = entryModeFromSetup(c.setupType);
      const key = chainPickKey(c.ticker, c.direction, { isLeaps, isYolo, entryMode });
      const withChain = applyLiveChain(base, enriched[key] ?? null);
      const finalized = finalizeCandidate(withChain);
      const gate = runDisciplineGate(finalized, { extendedSwingEnabled });

      const merged: TradeCandidate = {
        ...finalized,
        // Single source of truth for what the UI renders.
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
  }, [chainData, getLive, getReddit, extendedSwingEnabled]);

  const candidates = useMemo(
    () => traces.filter((t) => t.gate.visible).map((t) => t.c),
    [traces],
  );

  const matchesDte = (dte: number, f: DteBucketFilter): boolean => {
    if (f === "ALL") return true;
    if (f === "weekly") return dte >= 1 && dte <= 13;
    if (f === "short") return dte >= 14 && dte <= 30;
    if (f === "extended") return dte >= 31 && dte <= 45;
    if (f === "leaps") return dte >= 180;
    return true;
  };

  const filtered = useMemo(() => {
    const rows = candidates
      .filter((c) => dir === "ALL" || c.direction === dir)
      .filter((c) => label === "ALL" || c.label === label)
      .filter((c) => capFilter === "ALL" || c.cap === capFilter)
      .filter((c) => matchesDte(c.contract.dte, dteFilter))
      .filter((c) => c.contract.cost <= maxCost)
      .filter((c) => !triggerActiveOnly || c.triggerStatus === "active")
      .filter((c) => !verifiedOnly || c.contract.source === "chain")
      .filter((c) => !hideAvoids || c.label !== "Avoid")
      .filter((c) => includeLeaps || c.setupType !== "LEAPS")
      .filter((c) => includeYolo || c.setupType !== "Reddit YOLO");
    // Default sort: label group → trigger-active first → final score desc.
    return rows.sort((a, b) => {
      const dl = (LABEL_ORDER[a.label] ?? 9) - (LABEL_ORDER[b.label] ?? 9);
      if (dl !== 0) return dl;
      const ta = a.triggerStatus === "active" ? 0 : 1;
      const tb = b.triggerStatus === "active" ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return (b.finalScore ?? b.score) - (a.finalScore ?? a.score);
    });
  }, [candidates, dir, label, capFilter, dteFilter, maxCost, triggerActiveOnly, verifiedOnly, hideAvoids, includeLeaps, includeYolo]);

  const labelCounts = useMemo(() => {
    const out = { "Buy Now": 0, "Watchlist": 0, "Aggressive": 0, "Lotto": 0, "Find Better Strike": 0, "Avoid": 0 } as Record<Label, number>;
    for (const c of candidates) out[c.label] = (out[c.label] ?? 0) + 1;
    return out;
  }, [candidates]);

  const traceById = useMemo(() => {
    const m = new Map<string, { c: TradeCandidate; gate: DisciplineGateResult }>();
    for (const t of traces) m.set(t.c.id, t);
    return m;
  }, [traces]);
  const open = openId ? traceById.get(openId) ?? null : null;

  const liveCount = chainData
    ? Object.values(chainData.enriched).filter((v) => v !== null).length
    : 0;

  const symbolsForQuotes = symbols;
  const { get: getLiveQuote, anyLive } = { get: getLive, anyLive: chainData ? !chainData.rateLimited : false };
  void symbolsForQuotes; void getLiveQuote;
  const dataMode: "live" | "cached" | "delayed" | "demo" =
    chainData?.rateLimited ? "delayed"
    : chainData && Object.values(chainData.enriched).some((v) => v !== null) ? "live"
    : anyLive ? "cached"
    : "demo";
  const onRefreshQuotesOnly = () => {
    void qc.invalidateQueries({ queryKey: ["live-quotes"] });
    toast.success("Refreshing quotes…");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Scanner</h1>
          <p className="text-xs text-muted-foreground">
            Full scan reranks {fullScanIntervalMs > 0 ? `every ${Math.round(fullScanIntervalMs / 60_000)} min` : "only on demand"} · {liveCount}/{picks.length} live · Regime: <span className="text-foreground">Risk-on</span>
            {isStale ? " · ⚠ stale" : ""}
          </p>
        </div>
      </div>

      <RefreshBar
        lastFullScanAt={lastFullScanAt}
        nextFullScanAt={nextFullScanAt}
        marketDataUpdatedAt={lastFullScanAt}
        optionQuoteUpdatedAt={lastFullScanAt}
        dataMode={dataMode}
        autoRefresh={autoRefresh && fullScanIntervalMs > 0}
        isScanning={isScanning}
        onRunScanNow={runScan}
        onRefreshQuotesOnly={onRefreshQuotesOnly}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 text-xs">
        <Stat label="Total" value={candidates.length} />
        <Stat label="Buy Now" value={labelCounts["Buy Now"]} tone="bull" />
        <Stat label="Watchlist" value={labelCounts.Watchlist} tone="watch" />
        <Stat label="Aggressive" value={labelCounts.Aggressive} tone="warn" />
        <Stat label="Avoid" value={labelCounts.Avoid} tone="bear" />
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <Group label="Direction">
            {(["ALL", "CALL", "PUT"] as const).map((v) => (
              <Chip key={v} active={dir === v} onClick={() => setDir(v)}>{v === "ALL" ? "All" : v === "CALL" ? "Calls" : "Puts"}</Chip>
            ))}
          </Group>
          <Group label="Label">
            {(["ALL", "Buy Now", "Watchlist", "Aggressive", "Lotto", "Avoid"] as const).map((v) => (
              <Chip key={v} active={label === v} onClick={() => setLabel(v)}>{v === "ALL" ? "All" : v}</Chip>
            ))}
          </Group>
          <Group label="Cap">
            {(["ALL", "Mega", "Large", "Mid", "Small"] as const).map((v) => (
              <Chip key={v} active={capFilter === v} onClick={() => setCapFilter(v)}>{v === "ALL" ? "All" : v}</Chip>
            ))}
          </Group>
          <Group label="DTE">
            {([
              ["ALL","All"],["weekly","0–13"],["short","14–30"],["extended","31–45"],["leaps","180+"],
            ] as const).map(([v, lbl]) => (
              <Chip key={v} active={dteFilter === v} onClick={() => setDteFilter(v)}>{lbl}</Chip>
            ))}
          </Group>
          <Group label={`Max cost: $${maxCost}`}>
            <input type="range" min={100} max={5000} step={100} value={maxCost} onChange={(e) => setMaxCost(+e.target.value)} className="w-32 accent-[var(--color-bull)]" />
          </Group>
          <Group label="Toggles">
            <Chip active={triggerActiveOnly} onClick={() => setTriggerActiveOnly((v) => !v)}>Trigger active</Chip>
            <Chip active={verifiedOnly} onClick={() => setVerifiedOnly((v) => !v)}>Verified only</Chip>
            <Chip active={hideAvoids} onClick={() => setHideAvoids((v) => !v)}>Hide Avoids</Chip>
            <Chip active={includeLeaps} onClick={() => setIncludeLeaps((v) => !v)}>LEAPS</Chip>
            <Chip active={includeYolo} onClick={() => setIncludeYolo((v) => !v)}>YOLO</Chip>
            <Chip active={extendedSwingEnabled} onClick={() => setExtendedSwingEnabled((v) => !v)}>Extended Swing</Chip>
          </Group>
          <Group label="View">
            <Chip active={view === "table"} onClick={() => setView("table")}>Table</Chip>
            <Chip active={view === "card"} onClick={() => setView("card")}>Cards</Chip>
          </Group>
          <Group label="Mode">
            <Chip active={persona === "trader"} onClick={() => setPersona("trader")}>Trader</Chip>
            <Chip active={persona === "debug"} onClick={() => setPersona("debug")}>Debug</Chip>
          </Group>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">{filtered.length} candidates</div>

      {view === "table" ? (
        <TradeTable rows={filtered} onOpen={setOpenId} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No clean trades match your filters.
        </div>
      )}

      {persona === "debug" && <BuyNowTrace traces={traces} />}

      <TradeDetailDrawer
        open={openId !== null}
        onOpenChange={(v) => !v && setOpenId(null)}
        t={open?.c ?? null}
        gate={open?.gate ?? null}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bull" | "watch" | "warn" | "bear" }) {
  const cls =
    tone === "bull" ? "text-[var(--color-bull)]"
    : tone === "watch" ? "text-[var(--color-watch)]"
    : tone === "warn" ? "text-amber-500"
    : tone === "bear" ? "text-[var(--color-bear)]"
    : "text-foreground";
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("font-semibold mono", cls)}>{value}</span>
    </span>
  );
}

function BuyNowTrace({ traces }: { traces: { c: TradeCandidate; gate: DisciplineGateResult }[] }) {
  const [open, setOpen] = useState(true);
  const failures = traces.reduce((n, t) => n + t.gate.invariants.filter((i) => !i.pass).length, 0);
  return (
    <div className="rounded-xl border border-border bg-card">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-semibold">
        <span>Buy Now Trace ({traces.length} candidates · {failures} invariant failures)</span>
        <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-[10px]">
            <thead className="bg-muted/30 uppercase tracking-wider text-muted-foreground">
              <tr>
                {["Ticker","Source","Setup","Contract","Trigger","R/R","Data","Base","Final","UI","DTE","Bucket","Section","Visible","BN Elig","Blockers","Reasons","Inv"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {traces.map(({ c, gate }, i) => {
                const invFails = gate.invariants.filter((x) => !x.pass);
                return (
                  <tr key={`${c.id}-${i}`} className="border-t border-border align-top">
                    <td className="px-2 py-1 font-semibold">{c.ticker}</td>
                    <td className="px-2 py-1 mono">{gate.source}</td>
                    <td className="px-2 py-1 text-right mono">{gate.setupScore}</td>
                    <td className="px-2 py-1 text-right mono">{gate.contractScore}/35</td>
                    <td className="px-2 py-1 text-right mono">{gate.triggerScore}/10</td>
                    <td className="px-2 py-1 text-right mono">{gate.riskRewardScore}/10</td>
                    <td className="px-2 py-1 text-right mono">{gate.dataQualityScore}/10</td>
                    <td className="px-2 py-1 text-muted-foreground">{gate.baseLabel}</td>
                    <td className="px-2 py-1 font-semibold">{gate.finalLabel}</td>
                    <td className="px-2 py-1 font-semibold">{c.label}</td>
                    <td className="px-2 py-1 text-right mono">{gate.dte}</td>
                    <td className="px-2 py-1">{gate.bucket}</td>
                    <td className="px-2 py-1">{gate.routedSection}</td>
                    <td className="px-2 py-1">{gate.visible ? "yes" : "no"}</td>
                    <td className={cn("px-2 py-1 font-semibold", gate.buyNowEligible ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]")}>
                      {gate.buyNowEligible ? "Yes" : "No"}
                    </td>
                    <td className="px-2 py-1 text-[var(--color-bear)] max-w-[16rem]">{gate.buyNowBlockers.join(" · ") || "—"}</td>
                    <td className="px-2 py-1 max-w-[18rem] text-muted-foreground">{gate.reasons.join(" · ")}</td>
                    <td className={cn("px-2 py-1 font-semibold", invFails.length === 0 ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]")}>
                      {invFails.length === 0 ? "PASS" : `FAIL (${invFails.map((x) => x.id).join(",")})`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
