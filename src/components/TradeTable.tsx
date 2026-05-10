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
}: {
  rows: TradeCandidate[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-sm border border-border bg-card">
      <table className="w-full text-[11px] font-mono">
        <thead className="border-b border-border bg-muted/20 text-[9px] uppercase tracking-widest text-muted-foreground">
          <tr>
            {[
              ["", "w-1"],
              ["Ticker", ""],
              ["Dir", ""],
              ["Label", "min-w-[9rem]"],
              ["Score", "text-right"],
              ["Price", "text-right"],
              ["Exp", ""],
              ["Strike", "text-right"],
              ["Ask", "text-right"],
              ["Cost", "text-right"],
              ["Δ", "text-right"],
              ["IV", "text-right"],
              ["DTE", "text-right"],
              ["BE+", "text-right"],
              ["Vol", "text-right"],
              ["OI", "text-right"],
              ["Sprd", "text-right"],
              ["Trigger", ""],
              ["Reason", "min-w-[14rem]"],
              ["", ""],
            ].map(([h, cls], i) => (
              <th key={i} className={cn("px-2 py-1.5 text-left whitespace-nowrap", cls)}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t, rowIdx) => {
            const c = t.contract;
            const triggerActive = t.triggerStatus === "active";
            const isDemo = c.source !== "chain";
            return (
              <tr
                key={t.id}
                onClick={() => onOpen(t.id)}
                className={cn(
                  "cursor-pointer border-t border-border/50 transition-colors",
                  rowIdx % 2 === 0 ? "bg-transparent" : "bg-muted/5",
                  "hover:bg-muted/20",
                )}
              >
                {/* Label accent dot */}
                <td className="pl-2 pr-0 py-1.5 w-1">
                  <div className={cn("h-full w-0.5 rounded-full min-h-[1rem]", LABEL_DOT[t.label])} />
                </td>

                <td className="px-2 py-1.5 font-bold tracking-tight text-foreground whitespace-nowrap">
                  {t.ticker}
                  {isDemo && <span className="ml-1 text-[8px] font-normal text-muted-foreground/60">demo</span>}
                </td>

                <td className={cn("px-2 py-1.5 font-bold text-[10px]",
                  t.direction === "CALL" ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]"
                )}>
                  {t.direction}
                </td>

                <td className={cn("px-2 py-1.5 font-semibold whitespace-nowrap", LABEL_COLOR[t.label])}>
                  {t.label}
                </td>

                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                  <span className={cn(
                    (t.finalScore ?? t.score) >= 85 ? "text-[var(--color-bull)]"
                    : (t.finalScore ?? t.score) >= 70 ? "text-[var(--color-watch)]"
                    : "text-muted-foreground",
                  )}>
                    {t.finalScore ?? t.score}
                  </span>
                </td>

                <td className="px-2 py-1.5 text-right tabular-nums">${t.price.toFixed(2)}</td>
                <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{expShort(c.expiration)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">${c.strike}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">${c.ask.toFixed(2)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">${(c.cost ?? c.ask * 100).toFixed(0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{Math.abs(c.delta).toFixed(2)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtPct(c.iv)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{c.dte}d</td>
                <td className={cn("px-2 py-1.5 text-right tabular-nums",
                  c.breakevenMovePct > 0.1 ? "text-[var(--color-bear)]/80"
                  : c.breakevenMovePct > 0.05 ? "text-amber-500/80"
                  : "text-foreground/80",
                )}>
                  {fmtPct(c.breakevenMovePct)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtK(c.volume)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtK(c.openInterest)}</td>
                <td className={cn("px-2 py-1.5 text-right tabular-nums",
                  c.spreadPct > 0.15 ? "text-[var(--color-bear)]/80"
                  : c.spreadPct > 0.08 ? "text-amber-500/80"
                  : "text-foreground/80",
                )}>
                  {fmtPct(c.spreadPct)}
                </td>

                <td className={cn("px-2 py-1.5 whitespace-nowrap font-medium",
                  triggerActive ? "text-[var(--color-bull)]" : "text-muted-foreground",
                )}>
                  <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle",
                    triggerActive ? "bg-[var(--color-bull)]" : "bg-muted-foreground",
                  )} />
                  {triggerActive ? "Active" : (t.triggerStatus ?? "—")}
                </td>

                <td className="px-2 py-1.5 truncate max-w-[14rem] text-muted-foreground text-[10px]">
                  {(t.buyNowBlockers && t.buyNowBlockers[0]) || t.trend || ""}
                </td>

                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}
                    className="rounded border border-border/60 bg-background px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors"
                  >
                    →
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={20} className="px-4 py-8 text-center text-muted-foreground text-xs">
                No candidates match your filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
