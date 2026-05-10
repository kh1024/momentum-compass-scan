import type { TradeCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { displayLabelFor, DISPLAY_LABEL_STYLES, badgesFor, aiThesis, holdTimeframe, riskLevel } from "@/lib/uiVocabulary";
import { WatchlistButton } from "@/components/WatchlistButton";

function fmtPct(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

export function CompactTradeCard({
  t,
  onOpenDetails,
}: {
  t: TradeCandidate;
  /** Legacy prop — ignored. Warnings now surface as lightweight badges. */
  warnings?: string[];
  onOpenDetails: () => void;
}) {
  const c = t.contract;
  const score = t.finalScore ?? t.score;
  const display = displayLabelFor(t.label);
  const styles = DISPLAY_LABEL_STYLES[display];
  const badges = badgesFor(t);
  const thesis = aiThesis(t);
  const hold = holdTimeframe(t);
  const risk = riskLevel(t);

  const expShort = (() => {
    if (!c.expiration) return "—";
    const d = new Date(`${c.expiration}T00:00:00Z`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetails}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetails();
        }
      }}
      className="group relative w-full cursor-pointer overflow-hidden rounded-lg border border-border bg-card text-left transition-all hover:border-foreground/30 hover:bg-card/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
    >
      {/* Left accent bar */}
      <div className={cn("absolute inset-y-0 left-0 w-[3px]", styles.bar)} />

      <div className="space-y-2.5 px-4 py-3 pl-5">
        {/* Header: ticker · dir · score */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-bold tracking-tight">{t.ticker}</span>
              <span className={cn(
                "rounded px-1.5 py-px font-mono text-[10px] font-bold",
                t.direction === "CALL"
                  ? "bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
                  : "bg-[var(--color-bear)]/10 text-[var(--color-bear)]",
              )}>
                {t.direction}
              </span>
              <span className={cn("text-[11px] font-semibold uppercase tracking-wider", styles.text)}>
                {display}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground/60">{t.setupType}</span>
              <span className="mx-1 opacity-40">·</span>
              <span>${t.price.toFixed(2)}</span>
              <span className="mx-1 opacity-40">·</span>
              <span>{hold}</span>
              <span className="mx-1 opacity-40">·</span>
              <span className={cn(
                risk === "Low" ? "text-[var(--color-bull)]/70"
                : risk === "Moderate" ? "text-foreground/60"
                : risk === "High" ? "text-amber-500/80"
                : "text-purple-400/80",
              )}>{risk} risk</span>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="text-right">
              <div className={cn(
                "font-mono text-lg font-bold tabular-nums leading-none",
                score >= 85 ? "text-[var(--color-bull)]"
                : score >= 70 ? "text-amber-500"
                : "text-muted-foreground",
              )}>
                {score}
              </div>
              <div className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/60">Confidence</div>
            </div>
            <WatchlistButton t={t} />
          </div>
        </div>

        {/* AI thesis — one line */}
        <p className="line-clamp-2 text-xs leading-snug text-foreground/80">
          {thesis}
        </p>

        {/* Compact contract row */}
        <div className="grid grid-cols-4 gap-x-3 gap-y-0.5 rounded border border-border/50 bg-background/30 px-2.5 py-1.5 text-[10px]">
          <Cell k="Strike" v={`$${c.strike}`} />
          <Cell k="Exp" v={expShort} />
          <Cell k="Ask" v={`$${c.ask.toFixed(2)}`} />
          <Cell k="BE+" v={fmtPct(c.breakevenMovePct)}
            warn={c.breakevenMovePct > 0.1} />
        </div>

        {/* Badges */}
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {badges.map((b) => (
              <span
                key={b.kind}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                  b.tone === "good" ? "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
                  : b.tone === "warn" ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                  : b.tone === "danger" ? "border-[var(--color-bear)]/40 bg-[var(--color-bear)]/10 text-[var(--color-bear)]"
                  : "border-border bg-muted/30 text-muted-foreground",
                )}
              >
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function Cell({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">{k}</span>
      <span className={cn(
        "font-mono font-semibold tabular-nums",
        warn ? "text-amber-500" : "text-foreground/85",
      )}>{v}</span>
    </div>
  );
}
