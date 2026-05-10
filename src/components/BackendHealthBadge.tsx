import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { HealthResponse, BackendStatus } from "@/routes/api/health";

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health", { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const err = new Error(`Health check failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export function useBackendHealth() {
  return useQuery<HealthResponse>({
    queryKey: ["backend-health"],
    queryFn: fetchHealth,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    // Exponential backoff: ~1s, 2s, 4s, 8s, 16s before giving up.
    retry: 5,
    retryDelay: (attempt) => {
      const base = Math.min(1000 * 2 ** attempt, 16_000);
      const jitter = base * 0.3 * (Math.random() * 2 - 1);
      return Math.max(250, Math.round(base + jitter));
    },
  });
}

/**
 * Force a full reconnect: invalidate every cached query so all data sources
 * re-fetch in parallel. Returns when the health check completes (or fails).
 */
export function useRetryConnection() {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const retry = async () => {
    setPending(true);
    try {
      await qc.invalidateQueries();
      await qc.refetchQueries({ queryKey: ["backend-health"] });
    } finally {
      setPending(false);
    }
  };
  return { retry, pending };
}

const STATUS_STYLE: Record<BackendStatus | "unknown", { dot: string; label: string; text: string; border: string }> = {
  healthy:  { dot: "bg-[var(--color-bull)]",  label: "Backend Online",      text: "text-[var(--color-bull)]",  border: "border-[var(--color-bull)]/40" },
  degraded: { dot: "bg-amber-500 animate-pulse", label: "Partial Connectivity", text: "text-amber-500",         border: "border-amber-500/40" },
  offline:  { dot: "bg-destructive animate-pulse", label: "Backend Offline",   text: "text-destructive",       border: "border-destructive/40" },
  unknown:  { dot: "bg-muted-foreground animate-pulse", label: "Checking…",  text: "text-muted-foreground",   border: "border-border" },
};

export interface BackendHealthBadgeProps {
  className?: string;
  compact?: boolean;
}

export function BackendHealthBadge({ className, compact = false }: BackendHealthBadgeProps) {
  const { data, isLoading, isError, refetch, isFetching } = useBackendHealth();
  const status: BackendStatus | "unknown" =
    isLoading || isError || !data ? "unknown" : data.status;
  const style = STATUS_STYLE[status];

  const tooltip = data
    ? data.providers
        .map((p) => `${p.source}: ${p.ok ? `ok ${p.latencyMs ?? "?"}ms` : p.configured ? p.error ?? "no data" : "not configured"}`)
        .join("\n")
    : isError
      ? "Health check failed"
      : "Checking backend status…";

  return (
    <button
      type="button"
      onClick={() => refetch()}
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition hover:bg-card",
        style.border,
        style.text,
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", style.dot)} aria-hidden />
      <span>{style.label}</span>
      {!compact && data && status !== "unknown" && (
        <span className="font-mono text-[10px] normal-case text-muted-foreground">
          {data.liveProviders}/{data.configuredProviders} sources
        </span>
      )}
      {isFetching && <span className="text-[10px] text-muted-foreground">·</span>}
    </button>
  );
}

export function BackendHealthPanel() {
  const { data, isLoading, isError, refetch, isFetching } = useBackendHealth();

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">
        Checking backend connectivity…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-destructive">Backend health check failed</span>
          <button onClick={() => refetch()} className="rounded border border-destructive/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/10">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const style = STATUS_STYLE[data.status];

  return (
    <div className={cn("rounded-xl border bg-card/40 px-4 py-3 text-xs", style.border)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", style.dot)} aria-hidden />
          <span className={cn("font-semibold uppercase tracking-wider", style.text)}>{style.label}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{data.message}</span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-muted/30 disabled:opacity-50"
        >
          {isFetching ? "Checking…" : "Recheck"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {data.providers.map((p) => (
          <span
            key={p.source}
            title={p.error ?? p.note}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
              !p.configured
                ? "border-border/60 text-muted-foreground/70"
                : p.ok
                  ? "border-[var(--color-bull)]/40 text-[var(--color-bull)]"
                  : p.rateLimited
                    ? "border-amber-500/40 text-amber-500"
                    : "border-destructive/40 text-destructive",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                !p.configured ? "bg-muted-foreground/50" : p.ok ? "bg-[var(--color-bull)]" : p.rateLimited ? "bg-amber-500" : "bg-destructive",
              )}
              aria-hidden
            />
            {p.source}
            {p.ok && p.latencyMs != null && <span className="text-muted-foreground">{p.latencyMs}ms</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
