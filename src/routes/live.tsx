import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
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
  const { get: getLive } = useLiveQuotes(symbols);
  const { get: getReddit } = useRedditSentiment(symbols);

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
  const live = useMemo(() => {
    return traces
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
  }, [traces]);

  const traceById = useMemo(() => {
    const m = new Map<string, { c: TradeCandidate; gate: DisciplineGateResult }>();
    for (const t of traces) m.set(t.c.id, t);
    return m;
  }, [traces]);
  const open = openId ? traceById.get(openId) ?? null : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Live Opportunities</h1>
        <p className="text-xs text-muted-foreground">
          Exceptional intraday moves: unusual flow · momentum spikes · rapid score changes
        </p>
      </div>

      {live.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <div className="text-sm font-medium text-foreground/80">No exceptional intraday moves right now.</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Check back later — or browse the Daily AI Picks for next-day setups.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {live.map((t) => (
            <CompactTradeCard key={t.c.id} t={t.c} onOpenDetails={() => setOpenId(t.c.id)} />
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
