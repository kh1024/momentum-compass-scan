import type { TradeCandidate } from "@/lib/types";
import { LabelChip, DirectionChip } from "./Badges";
import { ScoreRing } from "./ScoreRing";
import { cn } from "@/lib/utils";

/**
 * Compact trader-view card. Shows the essential row info — no debug spam.
 * Tap "View Details" to open the drawer.
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
  const isLive = c.source === "chain";
  const dash = "—";
  const triggerActive = t.triggerStatus === "active";
  const top = warnings.slice(0, 2);

  return (
    <div className="rounded-xl border border-border bg-card p-4 transition hover:border-foreground/30">
      <div className="flex items-start gap-3">
        <ScoreRing score={t.finalScore ?? t.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold tracking-tight">{t.ticker}</span>
            <DirectionChip direction={t.direction} />
            <LabelChip label={t.label} />
            <span className="mono text-sm text-muted-foreground">${t.price.toFixed(2)}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{t.setupType}</span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
            <Stat k="Exp" v={isLive ? c.expiration : dash} />
            <Stat k="Strike" v={isLive ? `$${c.strike}` : dash} />
            <Stat k="Ask" v={isLive ? `$${c.ask.toFixed(2)}` : dash} />
            <Stat k="Cost" v={isLive ? `$${(c.ask * 100).toFixed(0)}` : dash} />
            <Stat k="Δ" v={isLive ? c.delta.toFixed(2) : dash} />
            <Stat k="IV" v={isLive ? `${(c.iv * 100).toFixed(0)}%` : dash} />
            <Stat k="DTE" v={isLive ? `${c.dte}d` : dash} />
            <Stat k="Vol/OI" v={isLive ? `${c.volume.toLocaleString()}/${c.openInterest.toLocaleString()}` : dash} />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 font-medium",
                triggerActive
                  ? "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
                  : "border-border text-muted-foreground",
              )}
            >
              Trigger: {triggerActive ? "Active" : t.triggerStatus ?? "—"}
            </span>
            {top.map((w, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full border border-[var(--color-bear)]/40 bg-[var(--color-bear)]/10 px-2 py-0.5 font-medium text-[var(--color-bear)]"
              >
                ⚠ {w}
              </span>
            ))}
            {warnings.length > top.length && (
              <span className="text-muted-foreground">+{warnings.length - top.length} more</span>
            )}
          </div>

          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{t.validationReason ?? t.trend}</p>

          <div className="mt-3 flex items-center justify-end">
            <button
              onClick={onOpenDetails}
              className="rounded-md border border-border bg-background px-3 py-1 text-xs font-semibold hover:bg-muted"
            >
              View Details
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-muted-foreground">{k}</span>
      <span className="mono font-medium">{v}</span>
    </div>
  );
}
