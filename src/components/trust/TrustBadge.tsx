import { cn } from "@/lib/utils";
import { STATUS_LABEL, type DataStatus, type TrustEnvelope } from "@/services/trust";

const TONE: Record<DataStatus, string> = {
  live: "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 text-[var(--color-bull)]",
  delayed: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  stale: "border-amber-600/40 bg-amber-600/10 text-amber-600",
  unavailable: "border-border bg-muted/30 text-muted-foreground",
  error: "border-[var(--color-bear)]/40 bg-[var(--color-bear)]/10 text-[var(--color-bear)]",
};

const DOT: Record<DataStatus, string> = {
  live: "bg-[var(--color-bull)] animate-pulse-dot",
  delayed: "bg-amber-500",
  stale: "bg-amber-600",
  unavailable: "bg-muted-foreground/60",
  error: "bg-[var(--color-bear)]",
};

interface TrustBadgeProps {
  envelope?: TrustEnvelope<unknown> | null;
  status?: DataStatus;
  label?: string;
  source?: string | null;
  className?: string;
}

/**
 * Single canonical pill showing data trust state. Pass either an envelope or
 * an explicit status — never reinvent your own colored pill in a component.
 */
export function TrustBadge({ envelope, status, label, source, className }: TrustBadgeProps) {
  const s: DataStatus = status ?? envelope?.status ?? "unavailable";
  const text = label ?? STATUS_LABEL[s];
  const src = source ?? envelope?.source ?? null;
  const ageMs = envelope?.ageMs ?? null;
  const tooltip = [
    src ? `Source: ${src}` : null,
    ageMs != null ? `Age: ${formatAge(ageMs)}` : null,
    envelope?.error ? `Error: ${envelope.error.message}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <span
      title={tooltip || undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        TONE[s],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[s])} />
      {text}
    </span>
  );
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}
