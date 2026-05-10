import { cn } from "@/lib/utils";
import {
  LIVE_STATE_LABEL,
  type LiveState,
  formatAgo,
} from "@/lib/liveStatus";
import { useEffect, useState } from "react";
import { useStableValue } from "@/hooks/useStableValue";

// Transient states that flip rapidly during refresh cycles. We hold the
// previous state briefly before allowing them to take over, and we let
// "important" terminal states (error/unavailable/stale) override immediately.
const TRANSIENT: ReadonlySet<LiveState> = new Set([
  "refreshing",
  "connecting",
]);
const URGENT: ReadonlySet<LiveState> = new Set([
  "error",
  "unavailable",
  "stale",
  "market-closed",
]);

const TONE: Record<LiveState, string> = {
  live: "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 text-[var(--color-bull)]",
  recent: "border-[var(--color-bull)]/30 bg-[var(--color-bull)]/5 text-[var(--color-bull)]/90",
  delayed: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  stale: "border-amber-600/40 bg-amber-600/10 text-amber-600",
  refreshing: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  connecting: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  "rate-limited": "border-amber-500/40 bg-amber-500/10 text-amber-500",
  "market-closed": "border-border bg-muted/30 text-muted-foreground",
  awaiting: "border-border bg-muted/30 text-muted-foreground",
  unavailable: "border-border bg-muted/30 text-muted-foreground",
  error: "border-[var(--color-bear)]/40 bg-[var(--color-bear)]/10 text-[var(--color-bear)]",
};

const DOT: Record<LiveState, string> = {
  live: "bg-[var(--color-bull)] animate-pulse-dot",
  recent: "bg-[var(--color-bull)]/70",
  delayed: "bg-amber-500",
  stale: "bg-amber-600",
  refreshing: "bg-sky-400 animate-pulse-dot",
  connecting: "bg-sky-400 animate-pulse-dot",
  "rate-limited": "bg-amber-500 animate-pulse-dot",
  "market-closed": "bg-muted-foreground/60",
  awaiting: "bg-muted-foreground/60",
  unavailable: "bg-muted-foreground/60",
  error: "bg-[var(--color-bear)] animate-pulse-dot",
};

interface StatusPillProps {
  state: LiveState;
  updatedAt?: number | null;
  source?: string | null;
  className?: string;
  showAge?: boolean;
}

/**
 * Canonical truthful status pill. Reflects actual data state — never shows
 * Live when quotes are missing.
 */
export function StatusPill({ state, updatedAt = null, source, className, showAge = true }: StatusPillProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!updatedAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [updatedAt]);

  const label = LIVE_STATE_LABEL[state];
  const ageSuffix =
    showAge && updatedAt && (state === "delayed" || state === "stale" || state === "refreshing")
      ? ` · ${formatAgo(updatedAt, now)}`
      : "";
  const tooltip = [
    source ? `Source: ${source}` : null,
    updatedAt ? `Last refresh: ${new Date(updatedAt).toLocaleTimeString()}` : "No successful refresh yet",
  ].filter(Boolean).join(" · ");

  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        TONE[state],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[state])} />
      {label}{ageSuffix}
    </span>
  );
}
