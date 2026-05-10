import type { TradeCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LabelChip, DirectionChip, ScoreBadge, SourceBadge, TriggerDot } from "./Badges";

const LABEL_ACCENT: Record<string, string> = {
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

function fmt(n: number | undefined | null, dec = 2, pre = ""): string {
  if (n == null || !isFinite(n)) return "—";
  return `${pre}${n.toFixed(dec)}`;
}
function fmtK(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}
function fmtPct(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}
function expShort(exp: string): string {
  if (!exp) return "—";
  const d = new Date(`${exp}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Cell({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">{k}</span>
      <span className={cn("mono text-xs font-semibold tabular-nums", warn ? "text-[var(--color-bear)]" : "text-[var(--color-foreground)]")}>
        {v}
      </span>
    </div>
  );
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
  const score = t.finalScore ?? t.score;
  const triggerActive = t.triggerStatus === "active";

  return (
    <div
      className="group relative overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] transition-all duration-150 hover:border-zinc-600 hover:shadow-lg hover:shadow-black/20"
      onClick={onOpenDetails}
      style={{ cursor: "pointer" }}
    >
      {/* Left accent bar */}
      <div className={cn("absolute inset-y-0 left-0 w-[3px]", LABEL_ACCENT[t.label] ?? "bg-zinc-600")} />

      <div className="pl-4 pr-3 pt-3 pb-3">
        {/* Row 1: Ticker / direction / label / score */}
        <div className="flex items-center gap-2">
          <span className="mono text-base font-bold tracking-tight">{t.ticker}</span>
          <DirectionChip direction={t.direction} />
          <LabelChip label={t.label} />
          <div className="ml-auto flex items-center gap-2">
            <SourceBadge source={c.source} />
            <ScoreBadge score={score} />
            <span className="mono text-sm font-semibold text-[var(--color-foreground)]">
              ${t.price.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Row 2: Setup + trend */}
        <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
          <span className="font-medium text-[var(--color-foreground)]/60">{t.setupType}</span>
          <span>·</span>
          <span className="truncate">{t.trend}</span>
        </div>

        {/* Contract data grid */}
        <div className="mt-3 grid grid-cols-4 gap-x-3 gap-y-1">
          <Cell k="EXP"    v={expShort(c.expiration)} />
          <Cell k="STRIKE" v={`$${c.strike}`} />
          <Cell k="ASK"    v={`$${c.ask.toFixed(2)}`} />
          <Cell k="COST"   v={`$${(c.cost ?? c.ask * 100).toFixed(0)}`} />
          <Cell k="DTE"    v={`${c.dte}d`} />
          <Cell k="Δ"      v={fmt(Math.abs(c.delta))} />
          <Cell k="IV"     v={fmtPct(c.iv)} />
          <Cell k="BE+"    v={fmtPct(c.breakevenMovePct)} warn={c.breakevenMovePct > 0.10} />
          <Cell k="VOL"    v={fmtK(c.volume)} />
          <Cell k="OI"     v={fmtK(c.openInterest)} />
          <Cell k="SPRD"   v={fmtPct(c.spreadPct)} warn={c.spreadPct > 0.15} />
          <Cell k="θ/d"    v={fmtPct(c.thetaBurnPct)} />
        </div>

        {/* Targets + trigger + warning */}
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-2.5">
          <TriggerDot active={triggerActive} />
          {t.target1 > 0 && (
            <span className="text-xs text-[var(--color-muted-foreground)]">
              T1 <span className="mono font-semibold text-[var(--color-foreground)]">${t.target1.toFixed(0)}</span>
            </span>
          )}
          {t.target2 > 0 && (
            <span className="text-xs text-[var(--color-muted-foreground)]">
              T2 <span className="mono font-semibold text-[var(--color-foreground)]">${t.target2.toFixed(0)}</span>
            </span>
          )}
          {warnings[0] && (
            <span className="ml-auto max-w-[12rem] truncate text-[11px] text-[var(--color-bear)]/80">
              ⚠ {warnings[0]}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onOpenDetails(); }}
            className="ml-auto rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-muted-foreground)] transition-colors hover:border-zinc-500 hover:text-[var(--color-foreground)]"
          >
            Details →
          </button>
        </div>
      </div>
    </div>
  );
}
