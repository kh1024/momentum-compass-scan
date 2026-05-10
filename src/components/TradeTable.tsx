import type { TradeCandidate, Label } from "@/lib/types";
import { cn } from "@/lib/utils";

const LABEL_COLOR: Record<Label, string> = {
  "Buy Now":            "text-[var(--color-buy-now)]",
  "Watchlist":          "text-[var(--color-watch)]",
  "Waiting on Trigger": "text-sky-400",
  "Aggressive":         "text-amber-500",
  "Lotto":              "text-purple-400",
  "Near Miss":          "text-fuchsia-400",
  "Find Better Strike": "text-amber-400",
  "Avoid Contract":     "text-orange-500",
  "Avoid Ticker":       "text-[var(--color-bear)]",
  "Avoid":              "text-muted-foreground",
};

const LABEL_DOT: Record<Label, string> = {
  "Buy Now":            "bg-[var(--color-buy-now)]",
  "Watchlist":          "bg-[var(--color-watch)]",
  "Waiting on Trigger": "bg-sky-400",
  "Aggressive":         "bg-amber-500",
  "Lotto":              "bg-purple-400",
  "Near Miss":          "bg-fuchsia-400",
  "Find Better Strike": "bg-amber-400",
  "Avoid Contract":     "bg-orange-500",
  "Avoid Ticker":       "bg-[var(--color-bear)]",
  "Avoid":              "bg-muted-foreground",
};

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function expShort(exp: string): string {
  if (!exp) return "—";
  const d = new Date(`${exp}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function TradeTable({
  rows,
  onOpen,
  isLoading,
}: {
  rows: TradeCandidate[];
  onOpen: (id: string) => void;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card py-16">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-[var(--color-bull)]" />
          <span className="text-xs">Scanning universe…</span>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 py-14 text-center">
        <div className="text-2xl text-muted-foreground/30">—</div>
        <div className="mt-2 text-sm font-medium text-muted-foreground">No candidates match current filters</div>
        <div className="mt-1 text-xs text-muted-foreground/60">Try relaxing DTE, direction, or label filters</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-[11px] font-mono">
        <thead className="sticky top-0 z-10 border-b border-border bg-muted/30 text-[9px] uppercase tracking-widest text-muted-foreground backdrop-blur">
          <tr>
            {[
              ["", "w-1"],
              ["Ticker", "min-w-[4rem]"],
              ["Dir", "w-12"],
              ["Label", "min-w-[9rem]"],
              ["Score", "text-right w-12"],
              ["Price", "text-right w-20"],
              ["Exp", "w-16"],
              ["Strike", "text-right w-16"],
              ["Ask", "text-right w-14"],
              ["Cost", "text-right w-14"],
              ["Δ", "text-right w-10"],
              ["IV", "text-right w-12"],
              ["DTE", "text-right w-10"],
              ["BE+", "text-right w-12"],
              ["Vol", "text-right w-14"],
              ["OI", "text-right w-14"],
              ["Sprd", "text-right w-12"],
              ["Trigger", "min-w-[6rem]"],
              ["Reason", "min-w-[12rem]"],
              ["", "w-8"],
            ].map(([h, cls], i) => (
              <th key={i} className={cn("px-2 py-1.5 text-left whitespace-nowrap", cls)}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((t) => {
            const c = t.contract;
            const triggerActive = t.triggerStatus === "active";
            const isDemo = c.source !== "chain";
            const score = t.finalScore ?? t.score;
            const topBlocker = t.buyNowBlockers?.[0];
            const topReason = topBlocker || t.trend || "";

            return (
              <tr
                key={t.id}
                onClick={() => onOpen(t.id)}
                className="cursor-pointer transition-colors hover:bg-muted/15 active:bg-muted/25"
              >
                {/* Label accent bar */}
                <td className="pl-1.5 pr-0 py-1 w-1">
                  <div className={cn("h-full w-[3px] rounded-full min-h-[1.25rem]", LABEL_DOT[t.label])} />
                </td>

                <td className="px-2 py-1 font-bold tracking-tight text-foreground whitespace-nowrap">
                  {t.ticker}
                  {isDemo && <span className="ml-1 text-[8px] font-normal text-muted-foreground/40">·</span>}
                </td>

                <td className={cn("px-2 py-1 font-bold text-[10px]",
                  t.direction === "CALL" ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]"
                )}>
                  {t.direction}
                </td>

                <td className={cn("px-2 py-1 font-semibold whitespace-nowrap", LABEL_COLOR[t.label])}>
                  {t.label}
                </td>

                <td className="px-2 py-1 text-right font-semibold tabular-nums">
                  <span className={cn(
                    score >= 85 ? "text-[var(--color-bull)]"
                    : score >= 70 ? "text-[var(--color-watch)]"
                    : "text-muted-foreground",
                  )}>
                    {score}
                  </span>
                </td>

                <td className="px-2 py-1 text-right tabular-nums">${t.price.toFixed(2)}</td>
                <td className="px-2 py-1 tabular-nums whitespace-nowrap">{expShort(c.expiration)}</td>
                <td className="px-2 py-1 text-right tabular-nums">${c.strike}</td>
                <td className="px-2 py-1 text-right tabular-nums">${c.ask.toFixed(2)}</td>
                <td className="px-2 py-1 text-right tabular-nums">${(c.cost ?? c.ask * 100).toFixed(0)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{Math.abs(c.delta).toFixed(2)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtPct(c.iv)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{c.dte}d</td>
                <td className={cn("px-2 py-1 text-right tabular-nums",
                  c.breakevenMovePct > 0.1 ? "text-[var(--color-bear)]/70"
                  : c.breakevenMovePct > 0.05 ? "text-amber-500/80"
                  : "",
                )}>
                  {fmtPct(c.breakevenMovePct)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtK(c.volume)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtK(c.openInterest)}</td>
                <td className={cn("px-2 py-1 text-right tabular-nums",
                  c.spreadPct > 0.15 ? "text-[var(--color-bear)]/70"
                  : c.spreadPct > 0.08 ? "text-amber-500/80"
                  : "",
                )}>
                  {fmtPct(c.spreadPct)}
                </td>

                <td className={cn("px-2 py-1 whitespace-nowrap text-[10px] font-medium",
                  triggerActive ? "text-[var(--color-bull)]" : "text-muted-foreground",
                )}>
                  <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle",
                    triggerActive ? "bg-[var(--color-bull)]" : "bg-muted-foreground/40",
                  )} />
                  {triggerActive ? "Active" : (t.triggerStatus ?? "—")}
                </td>

                <td className="px-2 py-1 max-w-[12rem] text-[10px]">
                  {topBlocker
                    ? <span className="text-[var(--color-bear)]/80 truncate block">{topBlocker}</span>
                    : <span className="text-muted-foreground/70 truncate block">{topReason}</span>
                  }
                </td>

                <td className="px-2 py-1 text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}
                    className="rounded border border-border/50 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors"
                    aria-label="Open details"
                  >
                    →
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
