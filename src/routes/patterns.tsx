import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { MOCK_PATTERNS, MOCK_BREAKOUTS } from "@/lib/mockData";
import { DemoBadge, LiveDataBadge, StaleBadge } from "@/components/Badges";
import { SectionHeader } from "@/components/SectionHeader";
import { PatternWhy } from "@/components/PatternWhy";
import { cn } from "@/lib/utils";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { anySymbolLive, liveStateFor, markLive } from "@/lib/liveStateTracker";

export const Route = createFileRoute("/patterns")({
  head: () => ({ meta: [{ title: "Patterns — Momentum Options Scanner" }] }),
  component: Patterns,
});

function Patterns() {
  const [filter, setFilter] = useState<"All" | "Bullish" | "Bearish">("All");
  const [tab, setTab] = useState<"patterns" | "seasonality">("patterns");
  const [symbol, setSymbol] = useState("");

  const allTickers = useMemo(
    () => Array.from(new Set([...MOCK_PATTERNS.map(p => p.ticker), ...MOCK_BREAKOUTS.map(b => b.ticker)])),
    [],
  );
  const { get: getLive } = useLiveQuotes(allTickers);

  const patterns = useMemo(() => MOCK_PATTERNS
    .map(p => {
      const live = getLive(p.ticker);
      if (!live) return p;
      markLive(p.ticker, "quote");
      const ratio = p.trigger > 0 ? live.price / p.trigger : 1;
      const scale = (n: number) => +(n * ratio).toFixed(2);
      return { ...p, trigger: live.price, target: scale(p.target), isDemo: false };
    })
    .filter(p => filter === "All" || p.bias === filter)
    .filter(p => !symbol || p.ticker.toLowerCase().includes(symbol.toLowerCase())),
    [filter, symbol, getLive]);

  const breakouts = useMemo(
    () => MOCK_BREAKOUTS.map(b => {
      const live = getLive(b.ticker);
      if (live) markLive(b.ticker, "quote");
      return live ? { ...b, price: live.price, isDemo: false } : b;
    }),
    [getLive],
  );
  const five = breakouts.filter(b => b.window === 5);
  const ten = breakouts.filter(b => b.window === 10);

  // Header badge is the union of "any tracked symbol live in this session"
  // and freshness, so it never flips back to demo on a transient miss.
  const headerState: "live" | "stale" | "demo" = (() => {
    if (!anySymbolLive(allTickers)) return "demo";
    return allTickers.some((t) => liveStateFor(t) === "live") ? "live" : "stale";
  })();

  return (
    <div className="space-y-6 px-6 py-6">
      <header>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Patterns</h1>
              {headerState === "live" ? <LiveDataBadge /> : headerState === "stale" ? <StaleBadge /> : <DemoBadge />}
            </div>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              Daily chart-pattern detection + behavioral seasonality on 25 symbols. Updates every 10 min.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            placeholder="Filter by symbol…"
            className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
          {(["All", "Bullish", "Bearish"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-semibold transition",
                filter === f
                  ? f === "Bullish" ? "border-[var(--color-bull)] bg-[var(--color-bull)]/15 text-[var(--color-bull)]"
                  : f === "Bearish" ? "border-[var(--color-bear)] bg-[var(--color-bear)]/15 text-[var(--color-bear)]"
                  : "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}>
              {f}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1">
          <Tab active={tab === "patterns"} onClick={() => setTab("patterns")}>Chart Patterns</Tab>
          <Tab active={tab === "seasonality"} onClick={() => setTab("seasonality")}>Seasonality</Tab>
        </div>
      </header>

      {tab === "patterns" ? (
        <>
          <section>
            <SectionHeader title="Chart Patterns" count={patterns.length} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {patterns.map(p => (
                <div key={p.ticker + p.pattern} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold">{p.ticker}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                      p.bias === "Bullish" ? "bg-[var(--color-bull)]/15 text-[var(--color-bull)]" : "bg-[var(--color-bear)]/15 text-[var(--color-bear)]")}>
                      {p.bias}
                    </span>
                  </div>
                  <div className="mt-1 text-sm">{p.pattern}</div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <Stat k="Confidence" v={`${p.confidence}%`} />
                    <Stat k="Trigger" v={`$${p.trigger.toFixed(2)}`} />
                    <Stat k="Target" v={`$${p.target.toFixed(2)}`} />
                  </div>
                  <PatternWhy
                    ticker={p.ticker}
                    pattern={p.pattern}
                    bias={p.bias}
                    trigger={p.trigger}
                    target={p.target}
                  />
                </div>
              ))}
            </div>
          </section>

          <BreakoutSection title="5-Day Breakout Alerts" subtitle="Symbols breaking above their 5-day high on volume ≥ 1.5× avg." rows={five} />
          <BreakoutSection title="10-Day Breakout Alerts" subtitle="Symbols breaking above their 10-day high on volume ≥ 1.5× avg." rows={ten} />
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Seasonality stats coming next phase.
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
      )}>
      {children}
    </button>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="mono text-sm font-semibold">{v}</div>
    </div>
  );
}

function BreakoutSection({ title, subtitle, rows }: { title: string; subtitle: string; rows: typeof MOCK_BREAKOUTS }) {
  return (
    <section>
      <SectionHeader title={title} subtitle={subtitle} count={rows.length} />
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Ticker</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">{rows[0]?.window}-Day High</th>
              <th className="px-3 py-2 text-right">Volume × Avg</th>
              <th className="px-3 py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.ticker + r.window} className="border-t border-border">
                <td className="px-3 py-2 font-bold">{r.ticker}</td>
                <td className="px-3 py-2 text-right mono">${r.price.toFixed(2)}</td>
                <td className="px-3 py-2 text-right mono">${r.high.toFixed(2)}</td>
                <td className="px-3 py-2 text-right mono text-[var(--color-bull)]">{r.volMultiple.toFixed(1)}×</td>
                <td className="px-3 py-2 text-right">
                  <span className="rounded-full bg-[var(--color-bull)]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--color-bull)]">Breakout</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
