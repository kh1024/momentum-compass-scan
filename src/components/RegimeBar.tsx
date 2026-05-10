import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { MarketRegime } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getQuotes } from "@/lib/quote.functions";

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
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.cooldownMs && d.cooldownMs > 0) return Math.min(d.cooldownMs + 1_000, 10 * 60_000);
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

  const tickers = [
    { name: "SPY", price: liveSpy?.price ?? regime.spy.price, changePct: liveSpy?.changePct ?? regime.spy.changePct, trend: liveSpy ? trendOf(liveSpy.changePct) : regime.spy.trend },
    { name: "QQQ", price: liveQqq?.price ?? regime.qqq.price, changePct: liveQqq?.changePct ?? regime.qqq.changePct, trend: liveQqq ? trendOf(liveQqq.changePct) : regime.qqq.trend },
    { name: "SMH", price: liveSmh?.price ?? regime.smh.price, changePct: liveSmh?.changePct ?? regime.smh.changePct, trend: liveSmh ? trendOf(liveSmh.changePct) : regime.smh.trend },
    { name: "VIX", price: regime.vix.level, changePct: 0, trend: regime.vix.trend },
  ];

  const biasColor =
    regime.bias === "Risk-on"  ? "text-[var(--color-bull)]"
    : regime.bias === "Risk-off" ? "text-[var(--color-bear)]"
    : "text-[var(--color-watch)]";

  const scannerColor =
    regime.scannerBias === "Calls favored" ? "text-[var(--color-bull)]"
    : regime.scannerBias === "Puts favored" ? "text-[var(--color-bear)]"
    : regime.scannerBias === "No clean trades" ? "text-muted-foreground"
    : "text-[var(--color-watch)]";

  return (
    <div className="sticky top-0 z-40 border-b border-border/50 bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center gap-0 px-4">
        {/* Market tickers */}
        {tickers.map((t, i) => {
          const isUp = t.trend === "Up";
          const isDown = t.trend === "Down";
          const isVix = t.name === "VIX";
          return (
            <div key={t.name} className={cn(
              "flex items-center gap-2 px-4 py-2 border-r border-border/40",
              i === 0 && "pl-0",
            )}>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t.name}</span>
              <span className="mono text-xs font-semibold tabular-nums text-foreground">
                {isVix ? t.price.toFixed(2) : `$${t.price.toFixed(2)}`}
              </span>
              {!isVix && (
                <span className={cn(
                  "mono text-[10px] font-medium tabular-nums",
                  isUp ? "text-[var(--color-bull)]" : isDown ? "text-[var(--color-bear)]" : "text-muted-foreground",
                )}>
                  {t.changePct >= 0 ? "+" : ""}{t.changePct.toFixed(2)}%
                </span>
              )}
              {isVix && (
                <span className={cn(
                  "mono text-[10px]",
                  isDown ? "text-[var(--color-bull)]" : isUp ? "text-[var(--color-bear)]" : "text-muted-foreground",
                )}>
                  {t.trend === "Up" ? "▲" : t.trend === "Down" ? "▼" : "▬"}
                </span>
              )}
            </div>
          );
        })}

        {/* Regime + scanner bias */}
        <div className="ml-auto flex items-center gap-5 text-[10px]">
          <span className={cn("font-bold uppercase tracking-widest", biasColor)}>
            {regime.bias}
          </span>
          <span className={cn("font-bold uppercase tracking-widest", scannerColor)}>
            {regime.scannerBias}
          </span>
          {/* Live indicator */}
          <span className={cn(
            "flex items-center gap-1.5 font-bold uppercase tracking-widest",
            live ? "text-[var(--color-bull)]" : "text-muted-foreground/50",
          )}>
            <span className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              live ? "bg-[var(--color-bull)] animate-pulse" : "bg-muted-foreground/40",
            )} />
            {live ? "Live" : "Demo"}
          </span>
        </div>
      </div>
    </div>
  );
}
