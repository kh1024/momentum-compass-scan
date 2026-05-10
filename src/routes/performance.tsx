import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ScatterChart, Scatter, ZAxis,
} from "recharts";
import { toast } from "sonner";

import {
  ALL_DEMO, type JoinedPick, type Grade,
  computeSummary, groupStats, bucketDte, bucketDelta, bucketIV, bucketTheta, bucketScore,
} from "@/lib/performanceData";
import { reviewTrade, generateScannerImprovements } from "@/lib/performance.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

export const Route = createFileRoute("/performance")({
  head: () => ({
    meta: [
      { title: "Performance — Momentum Options Scanner" },
      { name: "description", content: "AI-graded scanner pick performance, setup analytics, and rule-improvement suggestions." },
    ],
  }),
  component: PerformancePage,
});

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

function gradeColor(g: Grade): string {
  switch (g) {
    case "A+": case "A": return "bg-[var(--color-bull)]/15 text-[var(--color-bull)] border-[var(--color-bull)]/40";
    case "B": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "C": return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    case "D": return "bg-orange-500/10 text-orange-400 border-orange-500/30";
    case "F": return "bg-[var(--color-bear)]/15 text-[var(--color-bear)] border-[var(--color-bear)]/40";
  }
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function PerformancePage() {
  const all = ALL_DEMO;

  // Filters
  const [ticker, setTicker] = useState("");
  const [setupFilter, setSetupFilter] = useState<string>("ALL");
  const [resultFilter, setResultFilter] = useState<string>("ALL");

  const filtered = useMemo(() => all.filter(p => {
    if (ticker && !p.ticker.toLowerCase().includes(ticker.toLowerCase())) return false;
    if (setupFilter !== "ALL" && p.setupType !== setupFilter) return false;
    if (resultFilter === "WIN" && p.tracked.finalReturnPct <= 0) return false;
    if (resultFilter === "LOSS" && p.tracked.finalReturnPct > 0) return false;
    return true;
  }), [all, ticker, setupFilter, resultFilter]);

  const summary = useMemo(() => computeSummary(filtered), [filtered]);

  // Bucketed analytics
  const bySetup = useMemo(() => groupStats(filtered, p => p.setupType, p => p.tracked.finalReturnPct), [filtered]);
  const byScore = useMemo(() => groupStats(filtered, p => bucketScore(p.aiScore), p => p.tracked.finalReturnPct), [filtered]);
  const byDelta = useMemo(() => groupStats(filtered, p => bucketDelta(Math.abs(p.delta)), p => p.tracked.finalReturnPct), [filtered]);
  const byDte = useMemo(() => groupStats(filtered, p => bucketDte(p.dte), p => p.tracked.finalReturnPct), [filtered]);
  const byIVb = useMemo(() => groupStats(filtered, p => bucketIV(p.iv), p => p.tracked.finalReturnPct), [filtered]);
  const byThetab = useMemo(() => groupStats(filtered, p => bucketTheta(p.thetaBurnPct), p => p.tracked.finalReturnPct), [filtered]);
  const byRegime = useMemo(() => groupStats(filtered, p => p.marketRegime, p => p.tracked.finalReturnPct), [filtered]);
  const byTickerStats = useMemo(() => groupStats(filtered, p => p.ticker, p => p.tracked.finalReturnPct), [filtered]);

  // Detail panel
  const [selected, setSelected] = useState<JoinedPick | null>(null);

  const reviewFn = useServerFn(reviewTrade);
  const review = useMutation({
    mutationFn: (p: JoinedPick) => reviewFn({ data: {
      ticker: p.ticker, direction: p.direction, setupType: p.setupType, label: p.label,
      aiScore: p.aiScore, delta: p.delta, dte: p.dte, iv: p.iv,
      thetaBurnPct: p.thetaBurnPct, spreadPct: p.spreadPct, marketRegime: p.marketRegime,
      triggerFired: p.tracked.triggerFired, finalReturnPct: p.tracked.finalReturnPct,
      maxGainPct: p.tracked.maxGainPct, maxDrawdownPct: p.tracked.maxDrawdownPct,
      hitTarget1: p.tracked.hitTarget1, hitStop: p.tracked.hitStop,
      invalidated: p.tracked.invalidated, notes: p.tracked.notes,
    }}),
    onSuccess: r => { if (!r.ok && r.message) toast.error(r.message); },
    onError: e => toast.error(e instanceof Error ? e.message : "AI review failed."),
  });

  const improveFn = useServerFn(generateScannerImprovements);
  const improve = useMutation({
    mutationFn: () => improveFn({ data: {
      summary: summary as unknown as Record<string, unknown>,
      bySetup, byDelta, byDte, byTheta: byThetab, byIV: byIVb, byRegime,
    }}),
    onSuccess: r => { if (!r.ok && r.message) toast.error(r.message); },
    onError: e => toast.error(e instanceof Error ? e.message : "AI request failed."),
  });

  function exportCSV() {
    const headers = [
      "scanDate","ticker","direction","setupType","label","aiScore","priceAtScan",
      "strike","expiration","dte","delta","iv","thetaBurnPct","spreadPct",
      "triggerFired","finalReturnPct","maxGainPct","maxDrawdownPct","finalGrade","notes",
    ];
    const rows = filtered.map(p => [
      p.scanDate, p.ticker, p.direction, p.setupType, p.label, p.aiScore, p.priceAtScan,
      p.optionStrike, p.optionExpiration, p.dte, p.delta, p.iv, p.thetaBurnPct, p.spreadPct,
      p.tracked.triggerFired, p.tracked.finalReturnPct, p.tracked.maxGainPct, p.tracked.maxDrawdownPct,
      p.tracked.finalGrade, JSON.stringify(p.tracked.notes),
    ].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "scanner-performance.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Performance</h1>
          <p className="text-sm text-muted-foreground">
            AI-graded scanner picks, setup analytics, and rule-improvement suggestions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV}>Export CSV</Button>
          <Button size="sm" onClick={() => improve.mutate()} disabled={improve.isPending}>
            {improve.isPending ? "Generating…" : "Generate Scanner Improvements"}
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
        ⚠ Past scanner performance does not guarantee future results. Options are high risk. Demo data shown for illustration.
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Tracked picks" value={String(summary.totalTracked)} />
        <StatCard label="Win rate" value={pct(summary.winRate)} />
        <StatCard label="Avg return" value={signed(summary.avgReturn)} />
        <StatCard label="Median return" value={signed(summary.medianReturn)} />
        <StatCard label="Best trade" value={signed(summary.bestTradePct)} />
        <StatCard label="Worst trade" value={signed(summary.worstTradePct)} />
        <StatCard label="Avg MFE" value={pct(summary.avgMaxFavorable)} />
        <StatCard label="Avg MAE" value={signed(summary.avgMaxDrawdown)} />
        <StatCard label="Avg score · winners" value={summary.avgScoreWinners.toFixed(1)} />
        <StatCard label="Avg score · losers" value={summary.avgScoreLosers.toFixed(1)} />
        <StatCard label="Best setup" value={summary.bestSetup} />
        <StatCard label="Worst setup" value={summary.worstSetup} />
        <StatCard label="Best ticker" value={summary.bestTicker} />
        <StatCard label="Worst ticker" value={summary.worstTicker} />
        <StatCard label="Best DTE range" value={summary.bestDteRange} />
        <StatCard label="Best Δ range" value={summary.bestDeltaRange} />
        <StatCard label="Best regime" value={summary.bestMarketRegime} />
        <StatCard label="Avg hold" value={`${Math.round(summary.avgHoldTimeMin)} min`} />
      </div>

      {/* Improvement output */}
      {improve.data?.text && (
        <Card>
          <CardHeader><CardTitle className="text-base">AI Scanner Improvements</CardTitle></CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm text-foreground">{improve.data.text}</pre>
            <div className="mt-2 text-xs text-muted-foreground">
              Copy/paste these into your scanner prompt to evolve future picks.
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="picks" className="w-full">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="picks">Picks</TabsTrigger>
          <TabsTrigger value="accuracy">Scanner Accuracy</TabsTrigger>
          <TabsTrigger value="setups">Setup Breakdown</TabsTrigger>
          <TabsTrigger value="contracts">Contract Quality</TabsTrigger>
          <TabsTrigger value="regime">Market Regime</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        {/* PICKS TABLE */}
        <TabsContent value="picks" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Filter ticker…" value={ticker} onChange={e => setTicker(e.target.value)} className="w-40" />
            <Select value={setupFilter} onValueChange={setSetupFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All setups</SelectItem>
                {Array.from(new Set(all.map(p => p.setupType))).map(s =>
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Select value={resultFilter} onValueChange={setResultFilter}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="WIN">Winners</SelectItem>
                <SelectItem value="LOSS">Losers</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Ticker</th>
                    <th className="px-3 py-2">Setup</th>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2 text-right">Score</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                    <th className="px-3 py-2 text-right">DTE</th>
                    <th className="px-3 py-2 text-right">IV</th>
                    <th className="px-3 py-2 text-right">θ-burn</th>
                    
                    <th className="px-3 py-2 text-right">Final</th>
                    <th className="px-3 py-2 text-right">MFE</th>
                    <th className="px-3 py-2 text-right">MAE</th>
                    <th className="px-3 py-2">Grade</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => {
                    const t = p.tracked;
                    const win = t.finalReturnPct > 0;
                    return (
                      <tr key={p.id} className="border-t border-border hover:bg-accent/40">
                        <td className="px-3 py-2 text-muted-foreground">{p.scanDate}</td>
                        <td className="px-3 py-2 font-semibold">{p.ticker}</td>
                        <td className="px-3 py-2">{p.setupType}</td>
                        <td className="px-3 py-2"><Badge variant="outline">{p.label}</Badge></td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.aiScore}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.delta.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.dte}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{(p.iv*100).toFixed(0)}%</td>
                        <td className="px-3 py-2 text-right tabular-nums">{(p.thetaBurnPct*100).toFixed(1)}%</td>
                        
                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${win ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]"}`}>
                          {signed(t.finalReturnPct)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(t.maxGainPct)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{signed(t.maxDrawdownPct)}</td>
                        <td className="px-3 py-2"><Badge className={gradeColor(t.finalGrade)}>{t.finalGrade}</Badge></td>
                        <td className="px-3 py-2 text-right">
                          <Button variant="ghost" size="sm" onClick={() => setSelected(p)}>Review</Button>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={15} className="px-3 py-6 text-center text-sm text-muted-foreground">No picks match current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ACCURACY */}
        <TabsContent value="accuracy" className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <BucketCard title="Win rate by AI score" rows={byScore} metric="winRate" />
          <BucketCard title="Avg return by AI score" rows={byScore} metric="avgReturn" />
          <BucketCard title="Win rate by setup" rows={bySetup} metric="winRate" />
          <BucketCard title="Avg return by setup" rows={bySetup} metric="avgReturn" />
          <BucketCard title="Win rate by ticker" rows={byTickerStats} metric="winRate" />
          <BucketCard title="Avg return by ticker" rows={byTickerStats} metric="avgReturn" />
          <Card className="md:col-span-2">
            <CardHeader><CardTitle className="text-base">AI score vs actual return</CardTitle></CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="aiScore" name="Score" domain={[40, 100]} stroke="hsl(var(--muted-foreground))" />
                  <YAxis type="number" dataKey="ret" name="Return" tickFormatter={(v: number) => `${(v*100).toFixed(0)}%`} stroke="hsl(var(--muted-foreground))" />
                  <ZAxis range={[60, 60]} />
                  <Tooltip formatter={(v: number, n) => n === "ret" ? signed(v) : v} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                  <Scatter data={filtered.map(p => ({ aiScore: p.aiScore, ret: p.tracked.finalReturnPct, name: p.ticker }))} fill="hsl(var(--primary))" />
                </ScatterChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SETUPS */}
        <TabsContent value="setups" className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {bySetup.map(s => (
            <Card key={s.bucket}>
              <CardHeader><CardTitle className="text-base">{s.bucket}</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                <div>Picks: <span className="tabular-nums font-medium">{s.n}</span></div>
                <div>Win rate: <span className="tabular-nums font-medium">{pct(s.winRate)}</span></div>
                <div>Avg return: <span className={`tabular-nums font-medium ${s.avgReturn >= 0 ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]"}`}>{signed(s.avgReturn)}</span></div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* CONTRACT QUALITY */}
        <TabsContent value="contracts" className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <BucketCard title="Return by Δ range" rows={byDelta} metric="avgReturn" />
          <BucketCard title="Return by DTE range" rows={byDte} metric="avgReturn" />
          <BucketCard title="Return by IV range" rows={byIVb} metric="avgReturn" />
          <BucketCard title="Return by θ-burn range" rows={byThetab} metric="avgReturn" />
        </TabsContent>

        {/* REGIME */}
        <TabsContent value="regime" className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <BucketCard title="Win rate by market regime" rows={byRegime} metric="winRate" />
          <BucketCard title="Avg return by market regime" rows={byRegime} metric="avgReturn" />
        </TabsContent>

        {/* INSIGHTS */}
        <TabsContent value="insights" className="mt-4 space-y-3">
          <InsightCard
            title="Best setup type"
            body={`${summary.bestSetup} is producing the strongest avg return in the tracked window.`}
          />
          <InsightCard
            title="Worst habit"
            body={`Picks in the ${summary.worstSetup} bucket are dragging the book; tighten entry rules or downgrade label to Watchlist.`}
          />
          <InsightCard
            title="Score predictiveness"
            body={`Winners avg score ${summary.avgScoreWinners.toFixed(1)} vs losers ${summary.avgScoreLosers.toFixed(1)} — ${
              summary.avgScoreWinners - summary.avgScoreLosers > 5 ? "score is meaningfully predictive." : "score gap is small; consider tightening thresholds."
            }`}
          />
          <InsightCard
            title="Regime edge"
            body={`Best regime: ${summary.bestMarketRegime}. Down-size or skip on opposite-regime days.`}
          />
          <InsightCard
            title="Greeks edge"
            body={`Best Δ range: ${summary.bestDeltaRange} · Best DTE: ${summary.bestDteRange}. Bias contracts to this zone.`}
          />
        </TabsContent>
      </Tabs>

      {/* Detail sheet */}
      <Sheet open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <SheetContent className="w-full max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {selected.ticker} · {selected.direction} ·{" "}
                  <Badge className={gradeColor(selected.tracked.finalGrade)}>{selected.tracked.finalGrade}</Badge>
                </SheetTitle>
                <SheetDescription>{selected.setupType} · {selected.label} · scanned {selected.scanDate}</SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <KV label="Score" value={String(selected.aiScore)} />
                  <KV label="Confidence" value={String(selected.confidenceScore)} />
                  <KV label="Δ" value={selected.delta.toFixed(2)} />
                  <KV label="DTE" value={String(selected.dte)} />
                  <KV label="IV" value={`${(selected.iv*100).toFixed(0)}%`} />
                  <KV label="θ-burn" value={`${(selected.thetaBurnPct*100).toFixed(1)}%`} />
                  <KV label="Spread" value={`${(selected.spreadPct*100).toFixed(1)}%`} />
                  <KV label="OI / Vol" value={`${selected.openInterest.toLocaleString()} / ${selected.volume.toLocaleString()}`} />
                  
                  <KV label="Final return" value={signed(selected.tracked.finalReturnPct)} />
                  <KV label="MFE / MAE" value={`${pct(selected.tracked.maxGainPct)} / ${signed(selected.tracked.maxDrawdownPct)}`} />
                  <KV label="Hold time" value={`${selected.tracked.holdTimeMin} min`} />
                </div>

                <div className="grid grid-cols-5 gap-2">
                  <GradePill label="Setup" grade={selected.tracked.setupGrade} />
                  <GradePill label="Contract" grade={selected.tracked.contractGrade} />
                  <GradePill label="Entry" grade={selected.tracked.entryGrade} />
                  <GradePill label="Exit" grade={selected.tracked.exitGrade} />
                  <GradePill label="Final" grade={selected.tracked.finalGrade} />
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Notes</div>
                  <div className="mt-1">{selected.tracked.notes}</div>
                  {selected.tracked.improvement && (
                    <div className="mt-2 text-xs text-amber-300">Improvement: {selected.tracked.improvement}</div>
                  )}
                </div>

                <div className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">AI Trade Review</div>
                    <Button size="sm" onClick={() => review.mutate(selected)} disabled={review.isPending}>
                      {review.isPending ? "Thinking…" : "Generate AI grade"}
                    </Button>
                  </div>
                  {review.data?.text && (
                    <pre className="mt-3 whitespace-pre-wrap text-xs text-foreground">{review.data.text}</pre>
                  )}
                  {!review.data?.text && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Nova will grade pre-trade quality, post-trade outcome, and what label this should have been.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-muted/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm tabular-nums">{value}</div>
    </div>
  );
}

function GradePill({ label, grade }: { label: string; grade: Grade }) {
  return (
    <div className="rounded border border-border p-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <Badge className={`mt-1 ${gradeColor(grade)}`}>{grade}</Badge>
    </div>
  );
}

function BucketCard({
  title, rows, metric,
}: {
  title: string;
  rows: { bucket: string; n: number; winRate: number; avgReturn: number }[];
  metric: "winRate" | "avgReturn";
}) {
  const data = rows.map(r => ({ bucket: r.bucket, n: r.n, value: metric === "winRate" ? r.winRate : r.avgReturn }));
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis dataKey="bucket" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis tickFormatter={(v: number) => `${(v*100).toFixed(0)}%`} stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <Tooltip
              formatter={(v: number) => `${(v*100).toFixed(1)}%`}
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }}
            />
            <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function InsightCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
        <div className="mt-1 text-sm">{body}</div>
      </CardContent>
    </Card>
  );
}
