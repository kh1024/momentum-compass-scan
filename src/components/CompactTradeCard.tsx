import type { TradeCandidate, Label } from "@/lib/types";
import { cn } from "@/lib/utils";

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

  const expShort = (() => {
    if (!c.expiration) return "—";
    const d = new Date(`${c.expiration}T00:00:00Z`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  })();

  // Show top blocker in red; fall back to trend text
  const topBlocker = warnings[0];
  const moreBlockers = warnings.length > 1 ? warnings.length - 1 : 0;

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20">
      {/* Left accent bar */}
      <div className={cn("absolute inset-y-0 left-0 w-[3px]", LABEL_ACCENT[t.label])} />

      <div className="pl-3.5 pr-3 pt-3 pb-2.5">
        {/* ── Row 1: Ticker · Dir · Label ── */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold tracking-tight">{t.ticker}</span>
          <span className={cn(
            "rounded px-1 py-px text-[10px] font-bold font-mono",
            t.direction === "CALL"
              ? "bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
              : "bg-[var(--color-bear)]/10 text-[var(--color-bear)]",
          )}>
            {t.direction}
          </span>
          <span className={cn("text-[11px] font-semibold", LABEL_TEXT[t.label])}>
            {t.label}
          </span>
          <span className="ml-auto flex items-center gap-2.5">
            {isDemo && (
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40">Demo</span>
            )}
            <span className={cn(
              "font-mono text-xs font-bold tabular-nums",
              score >= 85 ? "text-[var(--color-bull)]"
              : score >= 70 ? "text-[var(--color-watch)]"
              : "text-muted-foreground",
            )}>
              {score}
            </span>
            <span className="font-mono text-xs font-semibold tabular-nums text-foreground/90">
              ${t.price.toFixed(2)}
            </span>
          </span>
        </div>

        {/* ── Row 2: Setup · trend ── */}
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground/50">{t.setupType}</span>
          <span className="mx-1 opacity-40">·</span>
          <span>{t.trend}</span>
        </div>

        {/* ── Contract grid: core 8 fields ── */}
        <div className="mt-2.5 grid grid-cols-4 gap-x-3 gap-y-1 text-[10px]">
          <Cell k="EXP"    v={expShort} />
          <Cell k="STRIKE" v={`$${c.strike}`} />
          <Cell k="ASK"    v={`$${c.ask.toFixed(2)}`} />
          <Cell k="COST"   v={`$${(c.cost ?? c.ask * 100).toFixed(0)}`} />
          <Cell k="DTE"    v={`${c.dte}d`} />
          <Cell k="Δ"      v={fmt(Math.abs(c.delta))} />
          <Cell k="IV"     v={fmtPct(c.iv)} />
          <Cell k="BE+"    v={fmtPct(c.breakevenMovePct)} highlight={c.breakevenMovePct > 0.1 ? "warn" : undefined} />
        </div>

        {/* ── Liquidity row ── */}
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground/70">
          <span>Vol <span className="font-mono font-semibold text-foreground/60">{fmtK(c.volume)}</span></span>
          <span>OI <span className="font-mono font-semibold text-foreground/60">{fmtK(c.openInterest)}</span></span>
          <span>Sprd <span className={cn("font-mono font-semibold", c.spreadPct > 0.15 ? "text-[var(--color-bear)]/70" : "text-foreground/60")}>{fmtPct(c.spreadPct)}</span></span>
          {t.target1 > 0 && (
            <span className="ml-auto">T1 <span className="font-mono font-semibold text-foreground/60">${t.target1.toFixed(0)}</span></span>
          )}
          {t.target2 > 0 && (
            <span>T2 <span className="font-mono font-semibold text-foreground/60">${t.target2.toFixed(0)}</span></span>
          )}
        </div>

        {/* ── Status + blocker row ── */}
        <div className="mt-2 flex items-center gap-2 border-t border-border/40 pt-2">
          <span className={cn(
            "flex items-center gap-1 text-[10px] font-medium",
            triggerActive ? "text-[var(--color-bull)]" : "text-muted-foreground/60",
          )}>
            <span className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              triggerActive ? "bg-[var(--color-bull)]" : "bg-muted-foreground/30",
            )} />
            {triggerActive ? "Trigger Active" : (t.triggerStatus ?? "Pending")}
          </span>

          {topBlocker && (
            <span className="ml-1 flex-1 truncate text-[10px] text-[var(--color-bear)]/75">
              {topBlocker}{moreBlockers > 0 && <span className="ml-1 text-muted-foreground/50">+{moreBlockers}</span>}
            </span>
          )}

          <button
            onClick={onOpenDetails}
            className="ml-auto shrink-0 rounded border border-border/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
          >
            Details →
          </button>
        </div>
      </div>
    </div>
  );
}

function Cell({ k, v, highlight }: { k: string; v: string; highlight?: "warn" | "danger" }) {
  return (
    <div className="flex items-baseline justify-between gap-0.5">
      <span className="uppercase tracking-wide text-muted-foreground/60" style={{ fontSize: "9px" }}>{k}</span>
      <span className={cn(
        "font-mono font-semibold tabular-nums",
        highlight === "warn" ? "text-amber-500" : highlight === "danger" ? "text-[var(--color-bear)]/70" : "text-foreground/85",
      )}>{v}</span>
    </div>
  );
}
