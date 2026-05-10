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

function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
}

function fmtAgo(ts: number | null): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function fmtIn(ts: number | null): string {
  if (!ts) return "manual";
  const s = Math.round((ts - Date.now()) / 1000);
  if (s <= 0) return "due";
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60);
  return `in ${m}m`;
}

export function RefreshBar(props: RefreshBarProps) {
  const {
    lastFullScanAt, nextFullScanAt, marketDataUpdatedAt, optionQuoteUpdatedAt,
    dataMode, autoRefresh, isScanning,
    onRunScanNow, onRefreshQuotesOnly, onToggleAutoRefresh,
  } = props;

  const modeColor =
    dataMode === "live" ? "text-[var(--color-bull)] border-[var(--color-bull)]/40 bg-[var(--color-bull)]/5"
    : dataMode === "cached" ? "text-[var(--color-watch)] border-[var(--color-watch)]/40 bg-[var(--color-watch)]/5"
    : dataMode === "delayed" ? "text-amber-500 border-amber-500/40 bg-amber-500/5"
    : "text-muted-foreground border-border";

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <Field k="Last full scan" v={fmtTime(lastFullScanAt)} sub={fmtAgo(lastFullScanAt)} />
        <Field k="Next full scan" v={autoRefresh ? fmtTime(nextFullScanAt) : "Manual"} sub={autoRefresh ? fmtIn(nextFullScanAt) : "—"} />
        <Field k="Market data" v={fmtAgo(marketDataUpdatedAt)} />
        <Field k="Option quote" v={fmtAgo(optionQuoteUpdatedAt)} />
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", modeColor)}>
          {dataMode}
        </span>
        <span className={cn(
          "rounded-full border px-2 py-0.5 text-[10px] font-medium",
          autoRefresh ? "border-[var(--color-bull)]/40 text-[var(--color-bull)]" : "border-border text-muted-foreground",
        )}>
          {autoRefresh ? "● Auto-refresh on" : "○ Auto-refresh paused"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onRefreshQuotesOnly}
            className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-semibold hover:bg-muted"
          >
            Refresh quotes
          </button>
          <button
            onClick={onToggleAutoRefresh}
            className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-semibold hover:bg-muted"
          >
            {autoRefresh ? "Pause auto" : "Resume auto"}
          </button>
          <button
            onClick={onRunScanNow}
            disabled={isScanning}
            className="rounded-md border border-[var(--color-bull)] bg-[var(--color-bull)]/10 px-3 py-1 text-[11px] font-semibold text-[var(--color-bull)] hover:bg-[var(--color-bull)]/20 disabled:opacity-50"
          >
            {isScanning ? "Scanning…" : "Run scan now"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</span>
      <span className="mono font-semibold text-foreground">{v}</span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </span>
  );
}
