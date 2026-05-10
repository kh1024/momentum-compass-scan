import type { TradeCandidate, Label } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---- Label accent colors --------------------------------------------------
const LABEL_ACCENT: Record<Label, string> = {
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

const LABEL_TEXT: Record<Label, string> = {
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

function fmt(n: number | undefined | null, decimals = 2, prefix = ""): string {
  if (n == null || !isFinite(n)) return "—";
  return `${prefix}${n.toFixed(decimals)}`;
}

function fmtK(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function fmtPct(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

/**
 * Bloomberg-terminal-style trade card.
 * Shows all contract data whether the source is chain or mock-seed.
 */
export function CompactTradeCard({
  t,
  warnings,
  onOpenDetails,
}: {
  t: TradeCandidate;
  warnings: string[];
  onOpenDetails: () => void;
}) {
  const c = t.contract;
  const isDemo = c.source !== "chain";
  const triggerActive = t.triggerStatus === "active";
  const score = t.finalScore ?? t.score;

  // Shorten expiration for display: 2026-05-16 → May 16
  const expShort = (() => {
    if (!c.expiration) return "—";
    const d = new Date(`${c.expiration}T00:00:00Z`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  })();

  return (
    <div
      className="group relative overflow-hidden rounded-sm border border-border bg-card transition-colors hover:border-foreground/20 hover:bg-card/80"
      style={{ borderLeft: "3px solid transparent" }}
    >
      {/* Left accent bar (label color) */}
      <div className={cn("absolute inset-y-0 left-0 w-[3px]", LABEL_ACCENT[t.label])} />

      <div className="pl-3 pr-2 pt-2.5 pb-2">
        {/* ── Row 1: Ticker / direction / label / score / price ── */}
        <div className="flex items-center gap-2">
          <span className="mono text-sm font-bold tracking-tight">{t.ticker}</span>
          <span className={cn(
            "mono rounded px-1 py-0 text-[10px] font-bold",
            t.direction === "CALL"
              ? "bg-[var(--color-bull)]/15 text-[var(--color-bull)]"
              : "bg-[var(--color-bear)]/15 text-[var(--color-bear)]",
          )}>
            {t.direction}
          </span>
          <span className={cn("text-[10px] font-semibold uppercase tracking-wide", LABEL_TEXT[t.label])}>
            {t.label}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {isDemo && (
              <span className="rounded border border-[var(--color-watch)]/30 px-1 py-0 text-[9px] font-bold uppercase tracking-wide text-[var(--color-watch)]/70">
                Demo
              </span>
            )}
            <span className={cn(
              "mono text-xs font-bold tabular-nums",
              score >= 85 ? "text-[var(--color-bull)]"
              : score >= 70 ? "text-[var(--color-watch)]"
              : "text-muted-foreground",
            )}>
              {score}
            </span>
            <span className="mono text-xs font-semibold tabular-nums text-foreground">
              ${t.price.toFixed(2)}
            </span>
          </span>
        </div>

        {/* ── Row 2: Setup + trend ── */}
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground/60">{t.setupType}</span>
          <span>·</span>
          <span className="truncate">{t.trend}</span>
        </div>

        {/* ── Contract data grid (always shown, demo or chain) ── */}
        <div className="mt-2 grid grid-cols-4 gap-x-2 gap-y-0.5 text-[10px]">
          <Cell k="EXP"    v={expShort} />
          <Cell k="STRIKE" v={`$${c.strike}`} />
          <Cell k="ASK"    v={`$${c.ask.toFixed(2)}`} />
          <Cell k="COST"   v={`$${(c.cost ?? c.ask * 100).toFixed(0)}`} />
          <Cell k="DTE"    v={`${c.dte}d`} />
          <Cell k="Δ"      v={fmt(Math.abs(c.delta))} />
          <Cell k="IV"     v={fmtPct(c.iv)} />
          <Cell k="BE+"    v={fmtPct(c.breakevenMovePct)} />
          <Cell k="VOL"    v={fmtK(c.volume)} />
          <Cell k="OI"     v={fmtK(c.openInterest)} />
          <Cell k="SPRD"   v={fmtPct(c.spreadPct)} />
          <Cell k="θ/d"    v={fmtPct(c.thetaBurnPct)} />
        </div>

        {/* ── Targets + trigger ── */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
          {/* Trigger status */}
          <span className={cn(
            "flex items-center gap-1 font-medium",
            triggerActive ? "text-[var(--color-bull)]" : "text-muted-foreground",
          )}>
            <span className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              triggerActive ? "bg-[var(--color-bull)]" : "bg-muted-foreground",
            )} />
            {triggerActive ? "Trigger Active" : (t.triggerStatus ?? "Not Active")}
          </span>

          {/* Targets */}
          {t.target1 > 0 && (
            <span className="text-muted-foreground">
              T1 <span className="mono font-medium text-foreground">${t.target1.toFixed(0)}</span>
            </span>
          )}
          {t.target2 > 0 && (
            <span className="text-muted-foreground">
              T2 <span className="mono font-medium text-foreground">${t.target2.toFixed(0)}</span>
            </span>
          )}

          {/* Top warning */}
          {warnings[0] && (
            <span className="ml-auto text-[var(--color-bear)]/80 truncate max-w-[12rem]">
              ⚠ {warnings[0]}
            </span>
          )}
          {warnings.length > 1 && (
            <span className="text-muted-foreground">+{warnings.length - 1}</span>
          )}
        </div>

        {/* ── Action row ── */}
        <div className="mt-2 flex items-center justify-end border-t border-border/50 pt-1.5">
          <button
            onClick={onOpenDetails}
            className="rounded border border-border bg-background px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
          >
            Details →
          </button>
        </div>
      </div>
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-0.5">
      <span className="text-muted-foreground/70 uppercase tracking-wide" style={{ fontSize: "9px" }}>{k}</span>
      <span className="mono font-semibold tabular-nums text-foreground/90">{v}</span>
    </div>
  );
}
