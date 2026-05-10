import { RefreshCw, Pause, Play, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RefreshBarProps {
  lastFullScanAt: number | null;
  nextFullScanAt: number | null;
  marketDataUpdatedAt: number | null;
  optionQuoteUpdatedAt: number | null;
  dataMode: "live" | "cached" | "delayed" | "demo";
  autoRefresh: boolean;
  isScanning: boolean;
  onRunScanNow: () => void;
  onRefreshQuotesOnly: () => void;
  onToggleAutoRefresh: () => void;
}

function fmtAgo(ts: number | null): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function fmtIn(ts: number | null): string {
  if (!ts) return "manual";
  const s = Math.round((ts - Date.now()) / 1000);
  if (s <= 0) return "due now";
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}

const MODE_STYLE: Record<string, string> = {
  live:    "bg-[var(--color-bull)]/10 text-[var(--color-bull)] ring-1 ring-[var(--color-bull)]/20",
  cached:  "bg-[var(--color-watch)]/10 text-[var(--color-watch)] ring-1 ring-[var(--color-watch)]/20",
  delayed: "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20",
  demo:    "bg-zinc-700/50 text-zinc-400 ring-1 ring-zinc-600/30",
};

export function RefreshBar(props: RefreshBarProps) {
  const {
    lastFullScanAt, nextFullScanAt, marketDataUpdatedAt,
    dataMode, autoRefresh, isScanning,
    onRunScanNow, onRefreshQuotesOnly, onToggleAutoRefresh,
  } = props;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5">
      {/* Mode badge */}
      <span className={cn(
        "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        MODE_STYLE[dataMode] ?? MODE_STYLE.demo,
      )}>
        {dataMode}
      </span>

      {/* Timestamps */}
      <Stat label="Last scan" value={fmtAgo(lastFullScanAt)} />
      {autoRefresh && nextFullScanAt && (
        <Stat label="Next scan" value={`in ${fmtIn(nextFullScanAt)}`} />
      )}
      <Stat label="Data" value={fmtAgo(marketDataUpdatedAt)} />

      {/* Auto-refresh toggle */}
      <button
        onClick={onToggleAutoRefresh}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
          autoRefresh
            ? "border-[var(--color-bull)]/30 text-[var(--color-bull)] hover:bg-[var(--color-bull)]/5"
            : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
        )}
      >
        {autoRefresh ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        {autoRefresh ? "Auto-refresh on" : "Paused"}
      </button>

      {/* Actions */}
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onRefreshQuotesOnly}
          className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
        >
          <RefreshCw className="h-3 w-3" />
          Quotes
        </button>
        <button
          onClick={onRunScanNow}
          disabled={isScanning}
          className="flex items-center gap-1.5 rounded-md bg-[var(--color-bull)] px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--color-bull)]/90 disabled:opacity-50"
        >
          <Zap className="h-3 w-3" />
          {isScanning ? "Scanning…" : "Scan now"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1 text-[11px]">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className="mono font-semibold text-[var(--color-foreground)]">{value}</span>
    </span>
  );
}
