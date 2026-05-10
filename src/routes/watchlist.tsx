import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Star, Trash2, Archive, RotateCcw, TrendingUp, TrendingDown, Clock, AlertTriangle } from "lucide-react";
import { useWatchlist, type WatchlistItem } from "@/hooks/useWatchlist";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { isMarketOpen } from "@/lib/marketHours";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/watchlist")({
  head: () => ({ meta: [{ title: "Watchlist — Momentum Options Scanner" }] }),
  component: WatchlistPage,
});

type Bucket = "active" | "winners" | "losers" | "stale" | "archived";

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function classify(item: WatchlistItem, livePrice: number | null): {
  bucket: Exclude<Bucket, "archived">;
  status: string;
  tone: "good" | "bad" | "neutral" | "warn";
} {
  if (livePrice == null) {
    return { bucket: "stale", status: "Awaiting quote", tone: "neutral" };
  }
  const dir = item.direction === "CALL" ? 1 : -1;
  const move = (livePrice - item.entryStockPrice) / item.entryStockPrice;
  const signed = move * dir;
  const target = item.target1 ? (item.target1 - item.entryStockPrice) / item.entryStockPrice * dir : null;

  if (target != null && signed >= target) return { bucket: "winners", status: "Hit target zone", tone: "good" };
  if (signed >= 0.03) return { bucket: "winners", status: "Moving in favor", tone: "good" };
  if (signed >= 0.005) return { bucket: "active", status: "Working", tone: "good" };
  if (signed > -0.005) return { bucket: "active", status: "Active", tone: "neutral" };
  if (signed > -0.03) return { bucket: "active", status: "Losing momentum", tone: "warn" };
  return { bucket: "losers", status: "Failed setup", tone: "bad" };
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
}

function dollar(n: number, decimals = 2): string {
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(decimals)}`;
}

function dteFromExp(exp: string): number {
  const d = new Date(`${exp}T16:00:00Z`);
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / (24 * 3600_000)));
}

function WatchlistPage() {
  const { items, remove, archive, restore } = useWatchlist();
  const [filter, setFilter] = useState<Bucket>("active");

  const tickers = useMemo(() => Array.from(new Set(items.map((i) => i.ticker))), [items]);
  const refreshMs = isMarketOpen() ? 30_000 : 5 * 60_000;
  const { get: getLive } = useLiveQuotes(tickers, { refetchIntervalMs: refreshMs });

  // Self-tick every 30s for "added Xm ago" labels.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const enriched = useMemo(() => {
    return items.map((it) => {
      const live = getLive(it.ticker);
      const livePrice = live?.price ?? null;
      const { bucket, status, tone } = it.archivedAt
        ? { bucket: "archived" as const, status: "Archived", tone: "neutral" as const }
        : classify(it, livePrice);
      const stockMove = livePrice != null ? livePrice - it.entryStockPrice : 0;
      const stockMovePct = livePrice != null ? stockMove / it.entryStockPrice : 0;
      const dir = it.direction === "CALL" ? 1 : -1;
      // Rough option P/L estimate: use delta * stock move (no live option mark yet).
      const optionPL = livePrice != null && it.contract
        ? null // explicit unknown — we don't have a live option mark on the watchlist tab
        : null;
      const dte = it.contract ? dteFromExp(it.contract.expiration) : null;
      return { it, live, livePrice, bucket, status, tone, stockMove, stockMovePct, dir, optionPL, dte };
    });
  }, [items, getLive]);

  const buckets = useMemo(() => {
    const m: Record<Bucket, typeof enriched> = { active: [], winners: [], losers: [], stale: [], archived: [] };
    for (const e of enriched) m[e.bucket].push(e);
    return m;
  }, [enriched]);

  const counts: Record<Bucket, number> = {
    active: buckets.active.length,
    winners: buckets.winners.length,
    losers: buckets.losers.length,
    stale: buckets.stale.length,
    archived: buckets.archived.length,
  };

  const visible = buckets[filter];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Watchlist</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Tracks every saved AI pick from the moment you added it. Stored locally — survives refresh.
        </p>
      </div>

      {/* Bucket tabs */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
        {(["active", "winners", "losers", "stale", "archived"] as Bucket[]).map((b) => (
          <button
            key={b}
            onClick={() => setFilter(b)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
              filter === b
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {b === "active" ? "Active" : b === "winners" ? "Winners" : b === "losers" ? "Losers" : b === "stale" ? "Stale" : "Archived"}
            <span className="ml-2 text-[10px] opacity-70">{counts[b]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2">
              <Star className="h-6 w-6 text-muted-foreground/40" />
              <div>No saved picks yet. Tap the star on any trade card to start tracking.</div>
            </div>
          ) : (
            <>No items in this bucket.</>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {visible.map((e) => (
            <WatchlistRow
              key={e.it.id}
              data={e}
              onRemove={() => remove(e.it.id)}
              onArchive={() => archive(e.it.id)}
              onRestore={() => restore(e.it.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface RowData {
  it: WatchlistItem;
  livePrice: number | null;
  status: string;
  tone: "good" | "bad" | "neutral" | "warn";
  stockMove: number;
  stockMovePct: number;
  dte: number | null;
}

function WatchlistRow({
  data,
  onRemove,
  onArchive,
  onRestore,
}: {
  data: RowData;
  onRemove: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const { it, livePrice, status, tone, stockMove, stockMovePct, dte } = data;
  const archived = !!it.archivedAt;
  const moveTone =
    livePrice == null ? "text-muted-foreground"
    : stockMovePct * (it.direction === "CALL" ? 1 : -1) > 0 ? "text-[var(--color-bull)]"
    : stockMovePct * (it.direction === "CALL" ? 1 : -1) < 0 ? "text-[var(--color-bear)]"
    : "text-muted-foreground";

  const statusCls =
    tone === "good" ? "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
    : tone === "bad" ? "border-[var(--color-bear)]/40 bg-[var(--color-bear)]/10 text-[var(--color-bear)]"
    : tone === "warn" ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
    : "border-border bg-muted/40 text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-base font-bold tracking-tight">{it.ticker}</span>
            <span className={cn(
              "rounded px-1.5 py-px font-mono text-[10px] font-bold",
              it.direction === "CALL"
                ? "bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
                : "bg-[var(--color-bear)]/10 text-[var(--color-bear)]",
            )}>{it.direction}</span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider", statusCls)}>
              {status}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            <span className="font-medium text-foreground/60">{it.setupType}</span>
            <span className="mx-1 opacity-40">·</span>
            <span>added {timeAgo(it.addedAt)}</span>
            <span className="mx-1 opacity-40">·</span>
            <span>entry score {it.entryScore}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {archived ? (
            <button onClick={onRestore} title="Restore" className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button onClick={onArchive} title="Archive" className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground">
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={onRemove} title="Remove" className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-[var(--color-bear)]">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Stock movement */}
      <div className="mt-3 grid grid-cols-3 gap-2 rounded border border-border/50 bg-background/30 px-2.5 py-2 text-[11px]">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Entry</div>
          <div className="mono font-semibold tabular-nums">${it.entryStockPrice.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Current</div>
          <div className={cn("mono font-semibold tabular-nums", livePrice == null && "text-muted-foreground/50")}>
            {livePrice != null ? `$${livePrice.toFixed(2)}` : "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60">P/L</div>
          {livePrice != null ? (
            <div className={cn("mono font-semibold tabular-nums", moveTone)}>
              {dollar(stockMove)} <span className="opacity-70">({pct(stockMovePct)})</span>
            </div>
          ) : (
            <div className="text-muted-foreground/50">—</div>
          )}
        </div>
      </div>

      {/* Contract row */}
      {it.contract && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <span className="text-muted-foreground/60 uppercase tracking-wider">Contract</span>
          <span className="mono font-semibold">${it.contract.strike} {it.contract.type.toUpperCase()}</span>
          <span className="text-muted-foreground/60">·</span>
          <span className="mono">exp {it.contract.expiration}</span>
          <span className="text-muted-foreground/60">·</span>
          <span className="mono">entry mark ${it.contract.mark.toFixed(2)}</span>
          {dte != null && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span className={cn("mono inline-flex items-center gap-1", dte <= 3 ? "text-amber-500" : "text-muted-foreground")}>
                <Clock className="h-3 w-3" /> {dte}d to exp
              </span>
            </>
          )}
        </div>
      )}

      {/* Targets / invalidation */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {it.target1 != null && (
          <span className="inline-flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-[var(--color-bull)]/70" /> T1 ${it.target1.toFixed(2)}
          </span>
        )}
        {it.target2 != null && (
          <span className="inline-flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-[var(--color-bull)]/50" /> T2 ${it.target2.toFixed(2)}
          </span>
        )}
        {it.invalidation && (
          <span className="inline-flex items-center gap-1 text-[var(--color-bear)]/70">
            <TrendingDown className="h-3 w-3" /> Stop: {it.invalidation}
          </span>
        )}
      </div>

      {it.entryThesis && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-foreground/70">
          <span className="text-muted-foreground/60">Why I added it: </span>{it.entryThesis}
        </p>
      )}

      {dte != null && dte <= 3 && !archived && (
        <div className="mt-2 inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-500">
          <AlertTriangle className="h-3 w-3" /> Expiring soon
        </div>
      )}
    </div>
  );
}
