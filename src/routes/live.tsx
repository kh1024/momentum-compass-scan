import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, TrendingUp, TrendingDown, Activity, Zap, Radio } from "lucide-react";
import { MOCK_CANDIDATES } from "@/lib/mockData";
import { CompactTradeCard } from "@/components/CompactTradeCard";
import { TradeDetailDrawer } from "@/components/TradeDetailDrawer";
import { enrichWithPublicChain, type EnrichmentResult } from "@/lib/chain.functions";
import type { TradeCandidate } from "@/lib/types";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useRedditSentiment } from "@/hooks/useRedditSentiment";
import { applyLiveChain, applyLiveQuote, applyRedditSignal, finalizeCandidate } from "@/lib/applyLiveQuote";
import { entryModeFromSetup } from "@/lib/entryMode";
import { chainPickKey } from "@/lib/chainKeys";
import { runDisciplineGate, type DisciplineGateResult } from "@/lib/disciplineGate";
import { aiInsights, freshness, marketCommentary, sectorStrength } from "@/lib/aiCommentary";
import { cn } from "@/lib/utils";
import { isMarketOpen } from "@/lib/marketHours";
import { useRiskFilters } from "@/hooks/useRiskFilters";
import { passesRiskFilters } from "@/lib/riskFilters";
import { useContractPreference } from "@/hooks/useContractPreference";
import { ContractPreferenceToolbar } from "@/components/ContractPreferenceToolbar";

export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "Live Opportunities — Momentum Options Scanner" }] }),
  component: LiveOpportunities,
});

function LiveOpportunities() {
  const [openId, setOpenId] = useState<string | null>(null);
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

  const { data: chainData } = useQuery<EnrichmentResult>({
    queryKey: ["dashboard-chain", picks.map((p) => `${p.ticker}:${p.direction}`).join(",")],
    queryFn: () => enrichFn({ data: { picks } }),
    enabled: picks.length > 0,
    staleTime: 5 * 60_000,
  });

  const symbols = useMemo(() => Array.from(new Set(MOCK_CANDIDATES.map((c) => c.ticker))), []);
  const quoteRefreshIntervalMs = isMarketOpen() ? 30_000 : 24 * 60 * 60_000;
  const { get: getLive, anyLive } = useLiveQuotes(symbols, { refetchIntervalMs: quoteRefreshIntervalMs });
  const { get: getReddit } = useRedditSentiment(symbols, { refetchIntervalMs: quoteRefreshIntervalMs });

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
      };
      return { c: merged, gate };
    });
  }, [chainData, getLive, getReddit]);

  // Surface only "exceptional" candidates: very high volume vs OI, or strong active momentum.
  const { filters: riskFilters, auto: riskAuto } = useRiskFilters();
  const live = useMemo(() => {
    return traces
      .filter((t) => riskAuto || passesRiskFilters(t.c, riskFilters))
      .map((t) => {
        const c = t.c.contract;
        const volRatio = c.openInterest > 0 ? c.volume / c.openInterest : 0;
        const isUnusualFlow = volRatio >= 0.5 && c.volume >= 500;
        const isStrongMomentum = t.c.triggerStatus === "active" && (t.c.finalScore ?? t.c.score) >= 80;
        const score = (volRatio * 50) + (isStrongMomentum ? 40 : 0) + (t.c.finalScore ?? t.c.score) * 0.3;
        return { ...t, score, isUnusualFlow, isStrongMomentum };
      })
      .filter((t) => t.isUnusualFlow || t.isStrongMomentum)
      .sort((a, b) => b.score - a.score);
  }, [traces, riskFilters, riskAuto]);

  const traceById = useMemo(() => {
    const m = new Map<string, { c: TradeCandidate; gate: DisciplineGateResult }>();
    for (const t of traces) m.set(t.c.id, t);
    return m;
  }, [traces]);
  const open = openId ? traceById.get(openId) ?? null : null;

  // ── Sidebar feeds ────────────────────────────────────────────────────────
  const spyQ = getLive("SPY");
  const qqqQ = getLive("QQQ");
  const smhQ = getLive("SMH");
  const updatedAt = Math.max(spyQ?.ts ?? 0, qqqQ?.ts ?? 0, smhQ?.ts ?? 0) || null;

  const liveQuotes = [spyQ, qqqQ, smhQ].filter((q): q is NonNullable<typeof q> => !!q);
  const avgChange = liveQuotes.length > 0
    ? liveQuotes.reduce((a, b) => a + b.changePct, 0) / liveQuotes.length
    : 0;
  const liveBias = liveQuotes.length === 0 ? undefined
    : avgChange > 0.3 ? "Risk-on"
    : avgChange < -0.3 ? "Risk-off"
    : "Neutral";

  const commentaryInput = {
    spy: spyQ ? { symbol: "SPY", changePct: spyQ.changePct } : undefined,
    qqq: qqqQ ? { symbol: "QQQ", changePct: qqqQ.changePct } : undefined,
    smh: smhQ ? { symbol: "SMH", changePct: smhQ.changePct } : undefined,
    bias: liveBias,
  };
  const commentary = liveQuotes.length > 0
    ? marketCommentary(commentaryInput)
    : "Live market data unavailable — waiting on quote provider.";
  const insights = liveQuotes.length > 0 ? aiInsights(commentaryInput) : ["Waiting for live market data…"];
  const sectors = liveQuotes.length > 0 ? sectorStrength(commentaryInput) : [];

  // Top movers (by intraday changePct) — driven by the live quote feed.
  const movers = useMemo(() => {
    const arr = symbols
      .map((s) => {
        const q = getLive(s);
        return q ? { symbol: s, price: q.price, changePct: q.changePct, ts: q.ts } : null;
      })
      .filter((x): x is { symbol: string; price: number; changePct: number; ts: number } => x !== null)
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    return arr;
  }, [symbols, getLive]);

  const gainers = movers.filter((m) => m.changePct > 0).slice(0, 5);
  const losers = movers.filter((m) => m.changePct < 0).slice(0, 5);

  // AI alert stream — synthesized from current data; rotates via insightIdx.
  const alerts = useMemo(() => {
    const a: { kind: "momentum" | "flow" | "sector" | "ai"; msg: string; ts: number }[] = [];
    const now = Date.now();
    for (const t of live.slice(0, 6)) {
      a.push({
        kind: t.isUnusualFlow ? "flow" : "momentum",
        msg: t.isUnusualFlow
          ? `Unusual ${t.c.direction.toLowerCase()} flow detected in ${t.c.ticker} — ${(t.c.contract.volume / Math.max(1, t.c.contract.openInterest)).toFixed(1)}× OI.`
          : `${t.c.ticker} momentum confirmed — AI confidence ${t.c.finalScore ?? t.c.score}.`,
        ts: now - Math.floor(Math.random() * 5 * 60_000),
      });
    }
    for (const s of sectors) {
      if (s.state === "Strong") a.push({ kind: "sector", msg: `${s.name} strength leading the tape (+${s.changePct.toFixed(2)}%).`, ts: now - 120_000 });
      if (s.state === "Weak")   a.push({ kind: "sector", msg: `${s.name} weakness — capital rotating away.`, ts: now - 180_000 });
    }
    for (const i of insights.slice(0, 3)) {
      a.push({ kind: "ai", msg: i, ts: now - Math.floor(Math.random() * 10 * 60_000) });
    }
    return a.sort((x, y) => y.ts - x.ts).slice(0, 12);
  }, [live, sectors, insights]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Live Opportunities</h1>
          <p className="text-xs text-muted-foreground">
            Real-time momentum, unusual flow, and AI alerts as they happen
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
          <span className={cn("flex items-center gap-1.5 font-semibold", anyLive ? "text-[var(--color-bull)]" : "text-amber-500")}>
            <Radio className={cn("h-3 w-3", anyLive && "animate-pulse-dot")} />
            {anyLive ? "Live" : "Delayed"}
          </span>
          <span className="text-muted-foreground">Updated {freshness(updatedAt)}</span>
        </div>
      </div>

      {/* AI commentary banner */}
      <div className="rounded-xl border border-[var(--color-bull)]/20 bg-gradient-to-r from-[var(--color-bull)]/[0.06] to-transparent px-4 py-3">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 text-[var(--color-bull)]" />
          <div className="flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-bull)]">AI Market Read</div>
            <div className="mt-0.5 text-sm text-foreground/90">{commentary}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Exceptional opportunities */}
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold tracking-wide">
              <Zap className="h-3.5 w-3.5 text-amber-500" /> Exceptional opportunities
              <span className="text-xs font-normal text-muted-foreground">{live.length}</span>
            </h2>
            {live.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <div className="text-sm font-medium text-foreground/80">No exceptional intraday moves right now.</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  AI is monitoring — the feed below shows everything moving.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {live.map((t) => (
                  <CompactTradeCard key={t.c.id} t={t.c} onOpenDetails={() => setOpenId(t.c.id)} />
                ))}
              </div>
            )}
          </section>

          {/* Movers */}
          <section className="grid gap-4 sm:grid-cols-2">
            <MoverList title="Top Gainers" icon={<TrendingUp className="h-3.5 w-3.5 text-[var(--color-bull)]" />} items={gainers} positive />
            <MoverList title="Top Losers" icon={<TrendingDown className="h-3.5 w-3.5 text-[var(--color-bear)]" />} items={losers} positive={false} />
          </section>
        </div>

        {/* Right rail: AI alerts + sector rotation */}
        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Activity className="h-3 w-3" /> AI Alerts
              </h3>
              <span className="text-[9px] text-muted-foreground/60">{alerts.length} events</span>
            </div>
            <div className="max-h-[480px] divide-y divide-border overflow-y-auto">
              {alerts.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  AI feed quiet — no notable events.
                </div>
              ) : alerts.map((a, i) => (
                <div key={i} className="px-3 py-2 text-[11px] leading-snug">
                  <div className="flex items-center gap-1.5">
                    <AlertDot kind={a.kind} />
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {a.kind === "flow" ? "Unusual flow"
                        : a.kind === "momentum" ? "Momentum"
                        : a.kind === "sector" ? "Sector"
                        : "AI insight"}
                    </span>
                    <span className="ml-auto text-[9px] text-muted-foreground/50">{freshness(a.ts)}</span>
                  </div>
                  <div className="mt-0.5 text-foreground/85">{a.msg}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sector Rotation</h3>
            <div className="space-y-1.5">
              {sectors.map((s) => (
                <div key={s.name} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-foreground/80">{s.name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-700",
                        s.changePct > 0 ? "bg-[var(--color-bull)]" : s.changePct < 0 ? "bg-[var(--color-bear)]" : "bg-muted-foreground/40",
                      )}
                      style={{ width: `${Math.min(100, Math.abs(s.changePct) * 60 + 15)}%` }}
                    />
                  </div>
                  <span className={cn(
                    "mono w-14 text-right tabular-nums text-[10px]",
                    s.changePct > 0 ? "text-[var(--color-bull)]"
                    : s.changePct < 0 ? "text-[var(--color-bear)]"
                    : "text-muted-foreground",
                  )}>
                    {s.changePct >= 0 ? "+" : ""}{s.changePct.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <TradeDetailDrawer
        open={!!open}
        onOpenChange={(v) => !v && setOpenId(null)}
        t={open?.c ?? null}
        gate={open?.gate ?? null}
      />
    </div>
  );
}

function AlertDot({ kind }: { kind: "momentum" | "flow" | "sector" | "ai" }) {
  const cls =
    kind === "flow" ? "bg-amber-500"
    : kind === "momentum" ? "bg-[var(--color-bull)]"
    : kind === "sector" ? "bg-sky-400"
    : "bg-fuchsia-400";
  return <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full animate-pulse-dot", cls)} />;
}

function MoverList({
  title, icon, items, positive,
}: {
  title: string;
  icon: React.ReactNode;
  items: { symbol: string; price: number; changePct: number }[];
  positive: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon} {title}
      </h3>
      {items.length === 0 ? (
        <div className="py-3 text-center text-xs text-muted-foreground/60">No {positive ? "gainers" : "losers"} yet.</div>
      ) : (
        <div className="space-y-1">
          {items.map((m) => (
            <div key={m.symbol} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono font-semibold text-foreground/90">{m.symbol}</span>
              <span className="mono ml-auto tabular-nums text-foreground/70">${m.price.toFixed(2)}</span>
              <span className={cn(
                "mono w-16 text-right tabular-nums font-semibold",
                m.changePct > 0 ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]",
              )}>
                {m.changePct >= 0 ? "+" : ""}{m.changePct.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
