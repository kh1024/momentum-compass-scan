import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { StatusPill } from "@/components/trust/StatusPill";
import {
  deriveLiveState,
  type LiveState,
  LIVE_STATE_EXPLAIN,
  formatAgo,
} from "@/lib/liveStatus";

export interface RefreshBarProps {
  lastFullScanAt: number | null;
  nextFullScanAt: number | null;
  marketDataUpdatedAt: number | null;
  optionQuoteUpdatedAt: number | null;
  /** Backwards-compatible coarse mode. */
  dataMode: "live" | "cached" | "delayed" | "demo";
  /** Truthful per-stream state — preferred. Falls back to dataMode if absent. */
  quoteState?: LiveState;
  chainState?: LiveState;
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
    dataMode, quoteState, chainState, autoRefresh, isScanning,
    onRunScanNow, onRefreshQuotesOnly, onToggleAutoRefresh,
  } = props;

  // Self-tick so "Xm ago" stays fresh without re-rendering the dashboard.
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Derive truthful states if caller didn't pass them.
  const qs: LiveState =
    quoteState ??
    deriveLiveState({
      updatedAt: marketDataUpdatedAt,
      rateLimited: dataMode === "delayed",
    });
  const cs: LiveState =
    chainState ??
    deriveLiveState({
      updatedAt: optionQuoteUpdatedAt,
      isFetching: isScanning,
      rateLimited: dataMode === "delayed",
    });

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <Field k="Last full scan" v={fmtTime(lastFullScanAt)} sub={lastFullScanAt ? formatAgo(lastFullScanAt) : "No scan yet"} />
        <Field k="Next full scan" v={autoRefresh ? fmtTime(nextFullScanAt) : "Manual"} sub={autoRefresh ? fmtIn(nextFullScanAt) : "—"} />

        <span className="flex items-baseline gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Market data</span>
          <StatusPill state={qs} updatedAt={marketDataUpdatedAt} showAge={false} />
          <span className="text-[10px] text-muted-foreground">
            {qs === "live" || qs === "refreshing"
              ? formatAgo(marketDataUpdatedAt)
              : LIVE_STATE_EXPLAIN[qs]}
          </span>
        </span>

        <span className="flex items-baseline gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Option chain</span>
          <StatusPill state={cs} updatedAt={optionQuoteUpdatedAt} showAge={false} />
          <span className="text-[10px] text-muted-foreground">
            {cs === "live" || cs === "refreshing"
              ? formatAgo(optionQuoteUpdatedAt)
              : cs === "unavailable"
                ? "Option chain temporarily unavailable"
                : LIVE_STATE_EXPLAIN[cs]}
          </span>
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
