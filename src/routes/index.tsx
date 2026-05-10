import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { MOCK_CANDIDATES } from "@/lib/mockData";
import { TradeTable } from "@/components/TradeTable";
import { TradeDetailDrawer } from "@/components/TradeDetailDrawer";
import { enrichWithPublicChain, type EnrichmentResult } from "@/lib/chain.functions";
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
  "Buy Now": 0, "Watchlist": 1, "Aggressive": 2, "Lotto": 3, "Find Better Strike": 4, "Avoid": 5,
};

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "bull" | "watch" | "warn" | "bear" }) {
  const cls =
    tone === "bull" ? "text-[var(--color-bull)]"
    : tone === "watch" ? "text-[var(--color-watch)]"
    : tone === "warn" ? "text-amber-500"
    : tone === "bear" ? "text-[var(--color-bear)]"
    : "text-foreground";
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", cls)}>{value}</span>
    </span>
  );
}

function Dashboard() {
  const [dir, setDir] = useState<Direction | "ALL">("ALL");
  const [labelF, setLabelF] = useState<Label | "ALL">("ALL");
  const [setupF, setSetupF] = useState<SetupType | "ALL">("ALL");
  const [hideAvoids, setHideAvoids] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(true);
  const AUTO_SYNC_MS = 30_000;
  const STALE_MS = 120_000;

  const enrichFn = useServerFn(enrichWithPublicChain);
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
    refetchInterval: autoSync ? AUTO_SYNC_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData,
  });
  const ageMs = dataUpdatedAt ? Date.now() - dataUpdatedAt : null;
  const isStale = ageMs != null && ageMs > STALE_MS;

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
  const { get: getLive } = useLiveQuotes(symbols);
  const { get: getReddit } = useRedditSentiment(symbols);
  const { get: getEarnings } = useEarnings(symbols, 60);
  void getEarnings; // reserved for drawer

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
      .filter((c) => !hideAvoids || c.label !== "Avoid");
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

  const liveCount = chainData ? Object.values(chainData.enriched).filter((v) => v !== null).length : 0;
  const lastSyncLabel = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour12: false }) : "—";

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
      {/* Summary bar */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <h1 className="text-base font-semibold">Dashboard</h1>
          <Stat label="Total" value={candidates.length} />
          <Stat label="Buy Now" value={labelCounts["Buy Now"]} tone="bull" />
          <Stat label="Watchlist" value={labelCounts.Watchlist} tone="watch" />
          <Stat label="Aggressive" value={labelCounts.Aggressive} tone="warn" />
          <Stat label="Lotto" value={labelCounts.Lotto} tone="warn" />
          <Stat label="Find Better Strike" value={labelCounts["Find Better Strike"]} tone="warn" />
          <Stat label="Avoid" value={labelCounts.Avoid} tone="bear" />
          <span className="ml-auto flex items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                isStale ? "border-amber-500/50 bg-amber-500/10 text-amber-500"
                : ageMs != null ? "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/5 text-[var(--color-bull)]"
                : "border-border text-muted-foreground",
              )}
            >
              {isScanning && ageMs == null ? "○ loading"
                : chainData?.rateLimited ? "⚠ rate-limited"
                : ageMs == null ? "○ no data"
                : `● live ${liveCount}/${picks.length} · ${Math.round(ageMs / 1000)}s ago`}
            </span>
            <span className="text-muted-foreground">Updated <span className="mono text-foreground">{lastSyncLabel}</span></span>
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} className="h-3 w-3 accent-[var(--color-bull)]" />
              Auto 30s
            </label>
            <button onClick={() => void refetchChain()} disabled={isScanning} className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-semibold hover:bg-muted disabled:opacity-50">
              {isScanning ? "Syncing…" : "Sync"}
            </button>
          </span>
        </div>
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
          {(["ALL", "Buy Now", "Watchlist", "Aggressive", "Lotto"] as const).map((l) => (
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
          Hide Avoid
        </label>
      </div>

      <TradeTable rows={filtered} onOpen={(id) => setOpenId(id)} />

      <TradeDetailDrawer
        open={!!open}
        onOpenChange={(v) => !v && setOpenId(null)}
        t={open?.c ?? null}
        gate={open?.gate ?? null}
      />
    </div>
  );
}
