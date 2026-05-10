import type { TradeCandidate, Label } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Tip, TIPS } from "@/components/Tip";
import { aiReasonFor } from "@/lib/aiReason";
import type { SectorStrength } from "@/lib/aiCommentary";
import { useWatchlist } from "@/hooks/useWatchlist";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { derivedMoneyness } from "@/lib/derivedMoneyness";

const displayLabel = (label: Label): Label | "Watchlist" => (label === "Waiting on Trigger" ? "Watchlist" : label);

// Replace internal "Avoid Ticker" wording with the friendlier product term.
const PUBLIC_LABEL: Partial<Record<Label, string>> = {
  "Avoid Ticker": "Low Quality Setup",
  "Avoid Contract": "Rejected Contract",
};

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

/** Score → tier styling. Stronger color scaling per spec:
 *  90+ elite, 80–89 strong, 70–79 moderate, <70 speculative. */
function scoreStyle(score: number): { color: string; bar: string; glow: string; tier: string } {
  if (score >= 90) return {
    color: "text-[var(--color-bull)]",
    bar: "bg-[var(--color-bull)]",
    glow: "shadow-[0_0_24px_-8px_var(--color-bull)]",
    tier: "Elite",
  };
  if (score >= 80) return {
    color: "text-[var(--color-bull)]/90",
    bar: "bg-[var(--color-bull)]/80",
    glow: "shadow-[0_0_18px_-10px_var(--color-bull)]",
    tier: "Strong",
  };
  if (score >= 70) return {
    color: "text-[var(--color-watch)]",
    bar: "bg-[var(--color-watch)]",
    glow: "",
    tier: "Moderate",
  };
  return { color: "text-muted-foreground", bar: "bg-muted-foreground/40", glow: "", tier: "Speculative" };
}

export interface TradeTableProps {
  rows: TradeCandidate[];
  onOpen: (id: string) => void;
  isLoading?: boolean;
  /** Optional sector context used to enrich the AI Reason column. */
  sectors?: SectorStrength[];
}

export function TradeTable({ rows, onOpen, isLoading, sectors }: TradeTableProps) {
  const { has: onWatchlist, toggle: toggleWatchlist } = useWatchlist();

  // Subtle price-change flash to make refreshes feel "live" without redrawing
  // the table. Tracks last seen price per row id; whenever it changes we mark
  // the row with up/down for ~700ms and CSS fades the background back to neutral.
  const prevPriceRef = useRef<Map<string, number>>(new Map());
  const [flash, setFlash] = useState<Record<string, "up" | "down" | undefined>>({});
  useEffect(() => {
    const next: Record<string, "up" | "down"> = {};
    for (const t of rows) {
      const prev = prevPriceRef.current.get(t.id);
      if (typeof prev === "number" && prev !== t.price) {
        next[t.id] = t.price > prev ? "up" : "down";
      }
      prevPriceRef.current.set(t.id, t.price);
    }
    if (Object.keys(next).length === 0) return;
    setFlash((f) => ({ ...f, ...next }));
    const id = setTimeout(() => {
      setFlash((f) => {
        const cleared = { ...f };
        for (const k of Object.keys(next)) delete cleared[k];
        return cleared;
      });
    }, 700);
    return () => clearTimeout(id);
  }, [rows]);

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

  const handleCopyContract = (t: TradeCandidate) => {
    const c = t.contract;
    const txt = `${t.ticker} ${c.expiration} ${t.direction} $${c.strike} @ $${(c.cost ?? c.ask * 100).toFixed(0)}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(txt);
      toast.success("Contract copied", { description: txt });
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-[11px] font-mono">
        <thead className="sticky top-0 z-10 border-b border-border bg-muted/30 text-[9px] uppercase tracking-widest text-muted-foreground backdrop-blur">
          <tr>
            {(
              [
                ["", "w-1", null],
                ["Ticker", "min-w-[4rem]", null],
                ["Dir", "w-12", null],
                ["Label", "min-w-[9rem]", null],
                ["Score", "text-right w-24", TIPS.score],
                ["AI Reason", "min-w-[16rem]", null],
                ["Moneyness", "min-w-[9rem]", null],
                ["Price", "text-right w-20", TIPS.price],
                ["Exp", "w-16", null],
                ["Strike", "text-right w-16", TIPS.strike],
                ["Cost", "text-right w-14", TIPS.cost],
                ["Δ", "text-right w-10", TIPS.delta],
                ["IV", "text-right w-12", TIPS.iv],
                ["DTE", "text-right w-10", TIPS.dte],
                ["BE+", "text-right w-12", TIPS.breakeven],
                ["Vol", "text-right w-14", TIPS.volume],
                ["OI", "text-right w-14", TIPS.oi],
                ["Sprd", "text-right w-12", TIPS.spread],
                ["Actions", "text-right w-24", null],
              ] as [string, string, React.ReactNode][]
            ).map(([h, cls, tip], i) => (
              <th key={i} className={cn("px-2 py-1.5 text-left whitespace-nowrap", cls)}>
                {tip ? (
                  <Tip content={tip} side="bottom">
                    <span className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">{h}</span>
                  </Tip>
                ) : h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((t) => {
            const c = t.contract;
            const score = t.finalScore ?? t.score;
            const ss = scoreStyle(score);
            const reason = aiReasonFor(t, { sectors });
            const m = derivedMoneyness(t);
            const moneyness = m.moneyness;
            const moneynessLabel = m.label;
            const watched = onWatchlist(t.id);
            const labelText = t.noQualityContract
              ? "No quality contract"
              : (PUBLIC_LABEL[t.label] ?? displayLabel(t.label));
            const isElite = score >= 90 && !t.noQualityContract;

            const f = flash[t.id];
            return (
              <tr
                key={t.id}
                onClick={() => onOpen(t.id)}
                className={cn(
                  "cursor-pointer transition-colors duration-700 hover:bg-muted/15 active:bg-muted/25",
                  isElite && "bg-[var(--color-bull)]/[0.04]",
                  f === "up" && "bg-[var(--color-bull)]/[0.10]",
                  f === "down" && "bg-[var(--color-bear)]/[0.10]",
                )}
              >
                {/* Label accent bar — wider/glowing for elite rows */}
                <td className="pl-1.5 pr-0 py-1 w-1">
                  <div className={cn(
                    "h-full rounded-full min-h-[1.5rem]",
                    isElite ? "w-[4px]" : "w-[3px]",
                    LABEL_DOT[t.label],
                    isElite && ss.glow,
                  )} />
                </td>

                <td className="px-2 py-1 font-bold tracking-tight text-foreground whitespace-nowrap">
                  {t.ticker}
                </td>

                <td className={cn("px-2 py-1 font-bold text-[10px]",
                  t.direction === "CALL" ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]"
                )}>
                  <Tip content={TIPS.direction[t.direction as "CALL" | "PUT"] ?? TIPS.direction.CALL}>
                    <span className="cursor-help">{t.direction}</span>
                  </Tip>
                </td>

                <td className={cn(
                  "px-2 py-1 font-semibold whitespace-nowrap",
                  t.noQualityContract ? "text-muted-foreground italic" : LABEL_COLOR[t.label],
                )}>
                  <Tip content={t.noQualityContract
                    ? <span>Ticker is worth watching, but no option on the chain passes quality / cost / liquidity filters right now ({t.noQualityReason ?? "no detail"}).</span>
                    : ((TIPS.label as Record<string, React.ReactNode>)[displayLabel(t.label)] ?? <span>{labelText}</span>)
                  }>
                    <span className="cursor-help">{labelText}</span>
                  </Tip>
                </td>

                {/* Score with confidence bar + numeric value */}
                <td className="px-2 py-1 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="relative h-1.5 w-12 overflow-hidden rounded-full bg-muted/40">
                      <div
                        className={cn("absolute inset-y-0 left-0 rounded-full", ss.bar)}
                        style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                      />
                    </div>
                    <span className={cn("font-semibold tabular-nums w-6 text-right", ss.color)}>{score}</span>
                  </div>
                </td>

                {/* AI Reason — concise, contextual */}
                <td className="px-2 py-1 text-foreground/80">
                  <span className="line-clamp-1" title={reason}>{reason}</span>
                </td>

                {/* Moneyness */}
                <td className="px-2 py-1 whitespace-nowrap">
                  <span className={cn(
                    "rounded-md border border-border/70 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium",
                    moneyness === "ATM" && "text-[var(--color-watch)] border-[var(--color-watch)]/40",
                    (moneyness === "ITM" || moneyness === "Slightly ITM") && "text-[var(--color-bull)]/90 border-[var(--color-bull)]/40",
                    moneyness === "Deep ITM" && "text-[var(--color-bull)] border-[var(--color-bull)]/60",
                    (moneyness === "Slightly OTM" || moneyness === "OTM") && "text-amber-400 border-amber-500/40",
                    (moneyness === "Far OTM" || moneyness === "Lottery OTM") && "text-purple-400 border-purple-400/40",
                  )}>
                    {moneynessLabel}
                  </span>
                </td>

                <td className={cn(
                  "px-2 py-1 text-right tabular-nums transition-colors duration-700",
                  f === "up" && "text-[var(--color-bull)]",
                  f === "down" && "text-[var(--color-bear)]",
                )}>${t.price.toFixed(2)}</td>
                <td className="px-2 py-1 tabular-nums whitespace-nowrap">{expShort(c.expiration)}</td>
                <td className="px-2 py-1 text-right tabular-nums">${c.strike}</td>
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

                {/* Quick actions */}
                <td className="px-2 py-1">
                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Tip content={watched ? "Remove from watchlist" : "Add to watchlist"} side="left">
                      <button
                        onClick={() => toggleWatchlist(t)}
                        className={cn(
                          "rounded border border-border/50 px-1.5 py-0.5 text-[11px] transition-colors hover:border-foreground/30",
                          watched ? "text-[var(--color-watch)] border-[var(--color-watch)]/50" : "text-muted-foreground hover:text-foreground",
                        )}
                        aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
                      >
                        {watched ? "★" : "☆"}
                      </button>
                    </Tip>
                    <Tip content="Copy contract" side="left">
                      <button
                        onClick={() => handleCopyContract(t)}
                        className="rounded border border-border/50 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors"
                        aria-label="Copy contract"
                      >
                        ⎘
                      </button>
                    </Tip>
                    <Tip content="Open AI thesis & details" side="left">
                      <button
                        onClick={() => onOpen(t.id)}
                        className="rounded border border-border/50 px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors"
                        aria-label="Open details"
                      >
                        →
                      </button>
                    </Tip>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
