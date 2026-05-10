import type { TradeCandidate, Label } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LabelChip, DirectionChip, ScoreBadge, SourceBadge, TriggerDot } from "./Badges";

function fmtPct(n: number): string { return `${(n * 100).toFixed(0)}%`; }
function fmtK(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n); }
function expShort(exp: string): string {
  if (!exp) return "—";
  const d = new Date(`${exp}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const COLS = [
  { h: "", cls: "w-[3px] p-0" },
  { h: "Ticker", cls: "pl-3" },
  { h: "Dir", cls: "" },
  { h: "Label", cls: "min-w-[9rem]" },
  { h: "Score", cls: "text-right" },
  { h: "Price", cls: "text-right" },
  { h: "Exp", cls: "" },
  { h: "Strike", cls: "text-right" },
  { h: "Ask", cls: "text-right" },
  { h: "Cost", cls: "text-right" },
  { h: "Δ", cls: "text-right" },
  { h: "IV", cls: "text-right" },
  { h: "DTE", cls: "text-right" },
  { h: "BE+", cls: "text-right" },
  { h: "Vol", cls: "text-right" },
  { h: "OI", cls: "text-right" },
  { h: "Sprd", cls: "text-right" },
  { h: "Trigger", cls: "" },
  { h: "Reason", cls: "min-w-[12rem]" },
  { h: "", cls: "" },
] as const;

const LABEL_ACCENT: Record<Label, string> = {
  "Buy Now":            "bg-[var(--color-bull)]",
  "Watchlist":          "bg-blue-400",
  "Waiting on Trigger": "bg-sky-400",
  "Aggressive":         "bg-[var(--color-watch)]",
  "Lotto":              "bg-[var(--color-lotto)]",
  "Near Miss":          "bg-fuchsia-400",
  "Find Better Strike": "bg-orange-400",
  "Avoid Contract":     "bg-orange-500",
  "Avoid Ticker":       "bg-[var(--color-bear)]",
  "Avoid":              "bg-zinc-600",
};

export function TradeTable({ rows, onOpen }: { rows: TradeCandidate[]; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
      <table className="w-full text-xs">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-background)]">
          <tr>
            {COLS.map(({ h, cls }, i) => (
              <th
                key={i}
                className={cn(
                  "px-2 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] whitespace-nowrap",
                  cls,
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]/50">
          {rows.map((t) => {
            const c = t.contract;
            const triggerActive = t.triggerStatus === "active";
            return (
              <tr
                key={t.id}
                onClick={() => onOpen(t.id)}
                className="cursor-pointer transition-colors hover:bg-[var(--color-accent)]/30"
              >
                {/* Accent dot column */}
                <td className="w-[3px] p-0">
                  <div className={cn("h-full w-[3px] min-h-[2.5rem]", LABEL_ACCENT[t.label])} />
                </td>

                <td className="py-2.5 pl-3 pr-2 font-semibold whitespace-nowrap">
                  {t.ticker}
                  <SourceBadge source={c.source} />
                </td>

                <td className="px-2 py-2.5">
                  <DirectionChip direction={t.direction} />
                </td>

                <td className="px-2 py-2.5">
                  <LabelChip label={t.label} size="xs" />
                </td>

                <td className="px-2 py-2.5 text-right">
                  <ScoreBadge score={t.finalScore ?? t.score} />
                </td>

                <td className="mono px-2 py-2.5 text-right tabular-nums">${t.price.toFixed(2)}</td>
                <td className="mono px-2 py-2.5 whitespace-nowrap tabular-nums">{expShort(c.expiration)}</td>
                <td className="mono px-2 py-2.5 text-right tabular-nums">${c.strike}</td>
                <td className="mono px-2 py-2.5 text-right tabular-nums">${c.ask.toFixed(2)}</td>
                <td className="mono px-2 py-2.5 text-right tabular-nums">${(c.cost ?? c.ask * 100).toFixed(0)}</td>
                <td className="mono px-2 py-2.5 text-right tabular-nums">{Math.abs(c.delta).toFixed(2)}</td>
                <td className="mono px-2 py-2.5 text-right tabular-nums">{fmtPct(c.iv)}</td>
                <td className="mono px-2 py-2.5 text-right tabular-nums">{c.dte}d</td>

                <td className={cn(
                  "mono px-2 py-2.5 text-right tabular-nums",
                  c.breakevenMovePct > 0.10 ? "text-[var(--color-bear)]/80"
                  : c.breakevenMovePct > 0.05 ? "text-[var(--color-watch)]/80"
                  : "text-[var(--color-foreground)]/80",
                )}>
                  {fmtPct(c.breakevenMovePct)}
                </td>

                <td className="mono px-2 py-2.5 text-right tabular-nums">{fmtK(c.volume)}</td>
                <td className="mono px-2 py-2.5 text-right tabular-nums">{fmtK(c.openInterest)}</td>

                <td className={cn(
                  "mono px-2 py-2.5 text-right tabular-nums",
                  c.spreadPct > 0.15 ? "text-[var(--color-bear)]/80"
                  : c.spreadPct > 0.08 ? "text-[var(--color-watch)]/80"
                  : "text-[var(--color-foreground)]/80",
                )}>
                  {fmtPct(c.spreadPct)}
                </td>

                <td className="px-2 py-2.5">
                  <TriggerDot active={triggerActive} />
                </td>

                <td className="max-w-[12rem] truncate px-2 py-2.5 text-[11px] text-[var(--color-muted-foreground)]">
                  {(t.buyNowBlockers && t.buyNowBlockers[0]) || t.trend || ""}
                </td>

                <td className="px-2 py-2.5 text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}
                    className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-muted-foreground)] transition-colors hover:border-zinc-500 hover:text-[var(--color-foreground)]"
                  >
                    →
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={20} className="px-4 py-12 text-center text-sm text-[var(--color-muted-foreground)]">
                No candidates match your filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
