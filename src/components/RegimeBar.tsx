import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { MarketRegime } from "@/lib/types";
import { DemoBadge } from "./Badges";
import { cn } from "@/lib/utils";
import { getQuotes } from "@/lib/quote.functions";

function trendArrow(t: "Up" | "Down" | "Flat") {
  return t === "Up" ? "▲" : t === "Down" ? "▼" : "▬";
}
function trendColor(t: "Up" | "Down" | "Flat") {
  return t === "Up" ? "text-[var(--color-bull)]" : t === "Down" ? "text-[var(--color-bear)]" : "text-muted-foreground";
}
function trendOf(pct: number): "Up" | "Down" | "Flat" {
  if (pct > 0.1) return "Up";
  if (pct < -0.1) return "Down";
  return "Flat";
}

export function RegimeBar({ regime }: { regime: MarketRegime }) {
  const fetchQuotes = useServerFn(getQuotes);
  const { data } = useQuery({
    queryKey: ["regime-quotes"],
    queryFn: () => fetchQuotes({ data: { symbols: ["SPY", "QQQ", "SMH"] } }),
    // While any provider is in cooldown, back off polling until it expires
    // (capped at 10min) so filter changes / re-renders never re-trigger
    // Massive while rate-limited.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.cooldownMs && d.cooldownMs > 0) {
        return Math.min(d.cooldownMs + 1_000, 10 * 60_000);
      }
      return 30_000;
    },
    refetchOnWindowFocus: (q) => !(q.state.data?.cooldownMs && q.state.data.cooldownMs > 0),
    refetchOnMount: false,
    staleTime: 25_000,
    retry: (count, err) => {
      const msg = err instanceof Error ? err.message : "";
      if (/rate.?limit|429/i.test(msg)) return false;
      return count < 1;
    },
  });

  const live = data?.live ?? false;
  const liveSpy = data?.quotes?.SPY ?? null;
  const liveQqq = data?.quotes?.QQQ ?? null;
  const liveSmh = data?.quotes?.SMH ?? null;
  const sourceLabel = liveSpy?.consensusSource
    ? liveSpy.consensusSource.charAt(0).toUpperCase() + liveSpy.consensusSource.slice(1)
    : "Live";

  const tickers = [
    {
      name: "SPY",
      price: liveSpy?.price ?? regime.spy.price,
      changePct: liveSpy?.changePct ?? regime.spy.changePct,
      trend: liveSpy ? trendOf(liveSpy.changePct) : regime.spy.trend,
    },
    {
      name: "QQQ",
      price: liveQqq?.price ?? regime.qqq.price,
      changePct: liveQqq?.changePct ?? regime.qqq.changePct,
      trend: liveQqq ? trendOf(liveQqq.changePct) : regime.qqq.trend,
    },
    {
      name: "SMH",
      price: liveSmh?.price ?? regime.smh.price,
      changePct: liveSmh?.changePct ?? regime.smh.changePct,
      trend: liveSmh ? trendOf(liveSmh.changePct) : regime.smh.trend,
    },
  ];

  const biasColor =
    regime.bias === "Risk-on" ? "text-[var(--color-bull)]" :
    regime.bias === "Risk-off" ? "text-[var(--color-bear)]" : "text-[var(--color-watch)]";
  const scannerColor =
    regime.scannerBias === "Calls favored" ? "text-[var(--color-bull)]" :
    regime.scannerBias === "Puts favored" ? "text-[var(--color-bear)]" :
    regime.scannerBias === "No clean trades" ? "text-muted-foreground" : "text-[var(--color-watch)]";

  return (
    <div className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-2.5 text-sm">
        {tickers.map(t => (
          <div key={t.name} className="flex items-center gap-2">
            <span className="font-bold tracking-wide">{t.name}</span>
            <span className="mono">${t.price.toFixed(2)}</span>
            <span className={cn("mono text-xs", trendColor(t.trend))}>
              {trendArrow(t.trend)} {t.changePct >= 0 ? "+" : ""}{t.changePct.toFixed(2)}%
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="font-bold tracking-wide">VIX</span>
          <span className="mono">{regime.vix.level.toFixed(2)}</span>
          <span className={cn("mono text-xs", trendColor(regime.vix.trend))}>{trendArrow(regime.vix.trend)}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className={cn("text-xs font-semibold uppercase tracking-wider", biasColor)}>Bias: {regime.bias}</span>
          <span className={cn("text-xs font-semibold uppercase tracking-wider", scannerColor)}>Scanner: {regime.scannerBias}</span>
          {live ? (
            <span className="rounded-full border border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-bull)]">
              ● Live · {sourceLabel}
            </span>
          ) : (
            regime.isDemo && <DemoBadge />
          )}
        </div>
      </div>
    </div>
  );
}
