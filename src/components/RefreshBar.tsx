import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { type LiveState, formatAgo } from "@/lib/liveStatus";
import { isMarketOpen } from "@/lib/marketHours";

export interface RefreshBarProps {
  lastFullScanAt: number | null;
  nextFullScanAt: number | null;
  marketDataUpdatedAt: number | null;
  optionQuoteUpdatedAt: number | null;
  /** Backwards-compatible coarse mode. */
  dataMode: "live" | "cached" | "delayed" | "demo";
  /** Truthful per-stream state. */
  quoteState?: LiveState;
  chainState?: LiveState;
  autoRefresh: boolean;
  isScanning: boolean;
  onRunScanNow: () => void;
  onRefreshQuotesOnly: () => void;
  onToggleAutoRefresh: () => void;
}

/** Single unified product-facing health classification. */
type Health = "live" | "healthy" | "delayed" | "market-closed" | "limited" | "offline";

const HEALTH_TONE: Record<Health, { pill: string; dot: string }> = {
  live:            { pill: "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 text-[var(--color-bull)]",       dot: "bg-[var(--color-bull)] animate-pulse-dot" },
  healthy:         { pill: "border-[var(--color-bull)]/30 bg-[var(--color-bull)]/5 text-[var(--color-bull)]/90",     dot: "bg-[var(--color-bull)]/80" },
  delayed:         { pill: "border-amber-500/40 bg-amber-500/10 text-amber-500",                                      dot: "bg-amber-500" },
  "market-closed": { pill: "border-border bg-muted/30 text-muted-foreground",                                         dot: "bg-muted-foreground/60" },
  limited:         { pill: "border-border bg-muted/30 text-muted-foreground",                                         dot: "bg-muted-foreground/60" },
  offline:         { pill: "border-[var(--color-bear)]/40 bg-[var(--color-bear)]/10 text-[var(--color-bear)]",       dot: "bg-[var(--color-bear)] animate-pulse-dot" },
};

const HEALTH_LABEL: Record<Health, string> = {
  live: "Live",
  healthy: "Healthy",
  delayed: "Delayed",
  "market-closed": "Market Closed",
  limited: "Limited Data",
  offline: "Offline",
};

/** Pick the calmer/worse of the two stream states and project onto Health. */
function deriveHealth(q: LiveState | undefined, c: LiveState | undefined, marketOpen: boolean): Health {
  const states: LiveState[] = [q, c].filter(Boolean) as LiveState[];
  if (states.length === 0) return marketOpen ? "healthy" : "market-closed";

  const has = (s: LiveState) => states.includes(s);

  if (has("error")) return "offline";
  if (has("unavailable")) return "limited";
  if (!marketOpen && (has("market-closed") || has("awaiting"))) return "market-closed";
  if (has("rate-limited") || has("stale") || has("delayed")) return "delayed";
  if (states.every((s) => s === "live")) return "live";
  // refreshing / recent / connecting / others — all "healthy"
  return "healthy";
}

function scanLabel(isScanning: boolean, lastFullScanAt: number | null, autoRefresh: boolean, marketOpen: boolean): string {
  if (isScanning) return "AI ranking opportunities";
  if (!lastFullScanAt) return marketOpen ? "Preparing first market scan" : "Standing by for next session";
  if (!marketOpen) return "After-hours mode — monitoring overnight momentum";
  return autoRefresh ? "Live market intelligence active" : "On-demand scanning enabled";
}

export function RefreshBar(props: RefreshBarProps) {
  const {
    lastFullScanAt, nextFullScanAt, marketDataUpdatedAt,
    quoteState, chainState, autoRefresh, isScanning,
    onRunScanNow, onToggleAutoRefresh,
  } = props;

  // Self-tick so "Xm ago" stays fresh without re-rendering the dashboard.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const marketOpen = isMarketOpen();
  const health = deriveHealth(quoteState, chainState, marketOpen);
  const tone = HEALTH_TONE[health];

  const lastVerified = lastFullScanAt
    ? `Verified ${formatAgo(lastFullScanAt, now)}`
    : "Latest verified scan loading";

  const nextRefresh = !autoRefresh
    ? null
    : nextFullScanAt
      ? `Next refresh ${formatAgo(nextFullScanAt, now).replace(" ago", "")}`
      : null;

  const tooltip = [
    marketDataUpdatedAt ? `Market data: ${new Date(marketDataUpdatedAt).toLocaleTimeString()}` : null,
    lastFullScanAt ? `Last scan: ${new Date(lastFullScanAt).toLocaleTimeString()}` : null,
    `Auto refresh: ${autoRefresh ? "on" : "off"}`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {/* LEFT: market + last verified scan */}
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {marketOpen ? "Market Open" : "Market Closed"}
          </span>
          <span className="text-xs text-foreground/80 transition-opacity duration-500">
            {lastVerified}
          </span>
        </div>

        {/* CENTER: AI scan activity */}
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-2 text-xs text-foreground/80">
            <span className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors duration-500",
              isScanning ? "bg-sky-400 animate-pulse-dot" : "bg-[var(--color-bull)]/70",
            )} />
            <span className="transition-opacity duration-500">
              {scanLabel(isScanning, lastFullScanAt, autoRefresh, marketOpen)}
            </span>
          </div>
        </div>

        {/* RIGHT: unified health + controls */}
        <div className="flex items-center gap-2">
          <span
            title={tooltip}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-500",
              tone.pill,
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
            {HEALTH_LABEL[health]}
          </span>

          {nextRefresh && (
            <span className="hidden text-[10px] uppercase tracking-wider text-muted-foreground/70 sm:inline">
              {nextRefresh}
            </span>
          )}

          <button
            onClick={onToggleAutoRefresh}
            className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground/80 hover:bg-muted"
            title={autoRefresh ? "Pause automatic refresh" : "Resume automatic refresh"}
          >
            {autoRefresh ? "Auto" : "Manual"}
          </button>
          <button
            onClick={onRunScanNow}
            disabled={isScanning}
            className="rounded-md border border-[var(--color-bull)]/60 bg-[var(--color-bull)]/10 px-3 py-1 text-[11px] font-semibold text-[var(--color-bull)] hover:bg-[var(--color-bull)]/20 disabled:opacity-50"
          >
            {isScanning ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
    </div>
  );
}
