import type { Label, Direction, Sentiment } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---- Label chip -----------------------------------------------------------

const LABEL_STYLES: Record<Label, string> = {
  "Buy Now":            "bg-[var(--color-bull)]/15 text-[var(--color-bull)] ring-1 ring-[var(--color-bull)]/30",
  "Watchlist":          "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20",
  "Waiting on Trigger": "bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20",
  "Aggressive":         "bg-[var(--color-watch)]/10 text-[var(--color-watch)] ring-1 ring-[var(--color-watch)]/20",
  "Lotto":              "bg-[var(--color-lotto)]/10 text-[var(--color-lotto)] ring-1 ring-[var(--color-lotto)]/20",
  "Near Miss":          "bg-fuchsia-500/10 text-fuchsia-400 ring-1 ring-fuchsia-500/20",
  "Find Better Strike": "bg-orange-500/10 text-orange-400 ring-1 ring-orange-500/20",
  "Avoid Contract":     "bg-orange-600/10 text-orange-500 ring-1 ring-orange-600/20",
  "Avoid Ticker":       "bg-[var(--color-bear)]/10 text-[var(--color-bear)] ring-1 ring-[var(--color-bear)]/20",
  "Avoid":              "bg-zinc-800 text-zinc-500 ring-1 ring-zinc-700",
};

export function LabelChip({ label, size = "sm" }: { label: Label; size?: "xs" | "sm" }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-md font-semibold uppercase tracking-wide",
      size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]",
      LABEL_STYLES[label],
    )}>
      {label}
    </span>
  );
}

// ---- Direction chip -------------------------------------------------------

export function DirectionChip({ direction }: { direction: Direction }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide",
      direction === "CALL"
        ? "bg-[var(--color-bull)]/15 text-[var(--color-bull)]"
        : "bg-[var(--color-bear)]/15 text-[var(--color-bear)]",
    )}>
      {direction}
    </span>
  );
}

// ---- Score badge ----------------------------------------------------------

export function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 85 ? "text-[var(--color-bull)] bg-[var(--color-bull)]/10"
    : score >= 70 ? "text-[var(--color-watch)] bg-[var(--color-watch)]/10"
    : "text-[var(--color-muted-foreground)] bg-[var(--color-muted)]/50";
  return (
    <span className={cn("mono inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold tabular-nums", cls)}>
      {score}
    </span>
  );
}

// ---- Source badge --------------------------------------------------------

export function SourceBadge({ source }: { source: string }) {
  if (source === "chain") return null;
  return (
    <span className="rounded border border-[var(--color-watch)]/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-watch)]/60">
      Demo
    </span>
  );
}

// ---- Sentiment badge -------------------------------------------------------

export function SentimentBadge({ sentiment }: { sentiment?: Sentiment | null }) {
  if (!sentiment || sentiment === "None") return null;
  const cls =
    sentiment === "Bullish" ? "text-[var(--color-bull)] bg-[var(--color-bull)]/10"
    : sentiment === "Bearish" ? "text-[var(--color-bear)] bg-[var(--color-bear)]/10"
    : "text-[var(--color-watch)] bg-[var(--color-watch)]/10";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide", cls)}>
      {sentiment}
    </span>
  );
}

// ---- Live/Demo dot -------------------------------------------------------

export function LiveDot({ live }: { live: boolean }) {
  return (
    <span className={cn(
      "flex items-center gap-1.5 text-[11px] font-medium",
      live ? "text-[var(--color-bull)]" : "text-[var(--color-muted-foreground)]",
    )}>
      <span className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        live ? "bg-[var(--color-bull)] animate-pulse-dot" : "bg-[var(--color-muted-foreground)]",
      )} />
      {live ? "Live" : "Demo"}
    </span>
  );
}

// ---- Trigger status dot --------------------------------------------------

export function TriggerDot({ active }: { active: boolean }) {
  return (
    <span className={cn(
      "flex items-center gap-1 text-xs font-medium",
      active ? "text-[var(--color-bull)]" : "text-[var(--color-muted-foreground)]",
    )}>
      <span className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        active ? "bg-[var(--color-bull)]" : "bg-[var(--color-muted-foreground)]",
      )} />
      {active ? "Active" : "Waiting"}
    </span>
  );
}
