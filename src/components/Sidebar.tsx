import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Zap, Star, Settings, ChevronRight, Wrench,
  TrendingUp, Activity, ScanSearch, FlaskConical, Radio, Sparkles, MessageSquare,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import { freshness, sectorStrength, sentimentScore, type CommentaryInput } from "@/lib/aiCommentary";
import { isMarketOpen } from "@/lib/marketHours";
import { readSnapshotHealth, type SnapshotHealthEntry } from "@/lib/marketSnapshots";

// Primary nav focuses on next-day prep + swing tracking. /live is a
// secondary surface, only shown when the market is open or dev mode is on.
const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Next-Day & Swing" },
  { to: "/scanner", icon: ScanSearch, label: "Scanner" },
  { to: "/watchlist", icon: Star, label: "Watchlist" },
  { to: "/reddit-signals", icon: MessageSquare, label: "Reddit Signals" },
] as const;

const NAV_LIVE = { to: "/live", icon: Zap, label: "Live (market hours)" } as const;

const NAV_DEV = [
  { to: "/performance", icon: TrendingUp, label: "Performance" },
  { to: "/patterns", icon: Activity, label: "Patterns" },
  { to: "/io-data", icon: FlaskConical, label: "Data Inspector" },
] as const;

const NAV_BOTTOM = [
  { to: "/settings", icon: Settings, label: "Settings" },
] as const;

export interface SidebarMarket {
  symbol: string;
  price: number;
  changePct: number;
  trend: "Up" | "Down" | "Flat";
}

interface SidebarProps {
  markets?: SidebarMarket[];
  /** True when at least one provider returned a fresh quote. */
  live?: boolean;
  /** Epoch ms of the freshest market quote, for the "Updated Xm ago" label. */
  updatedAt?: number | null;
  regime?: string;
  /** AI-derived commentary lines that rotate in the AI panel. */
  insights?: string[];
}

function NavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
}) {
  const { location } = useRouterState();
  const active = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--color-accent)] text-[var(--color-foreground)]"
          : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/50 hover:text-[var(--color-foreground)]",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
      {active && <ChevronRight className="ml-auto h-3 w-3 opacity-50" />}
    </Link>
  );
}

function FlashPrice({ value }: { value: number }) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [prev, setPrev] = useState(value);
  useEffect(() => {
    if (value === prev) return;
    setFlash(value > prev ? "up" : "down");
    setPrev(value);
    const id = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(id);
  }, [value, prev]);
  return (
    <span
      className={cn(
        "mono ml-auto font-semibold tabular-nums transition-colors",
        flash === "up" ? "text-[var(--color-bull)]"
        : flash === "down" ? "text-[var(--color-bear)]"
        : "text-[var(--color-foreground)]",
      )}
    >
      ${value.toFixed(2)}
    </span>
  );
}

function formatAge(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function SnapshotHealthPanel() {
  const [entries, setEntries] = useState<SnapshotHealthEntry[]>([]);
  useEffect(() => {
    const refresh = () => setEntries(readSnapshotHealth());
    refresh();
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, []);
  if (entries.length === 0) {
    return (
      <div className="mt-2 rounded-md border border-dashed border-border/60 bg-card/30 px-2 py-1.5 text-[10px] text-muted-foreground/70">
        No snapshots yet — first refresh will seed them.
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1 rounded-md border border-border bg-card/40 px-2 py-1.5">
      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Snapshot Health
      </div>
      {entries.slice(0, 6).map((e) => {
        const fresh = e.ageMs != null && e.ageMs < 5 * 60_000;
        return (
          <div key={e.key} className="flex items-center justify-between gap-2 text-[10px]">
            <span className="truncate text-muted-foreground" title={e.key}>{e.label}</span>
            <span className={cn(
              "mono shrink-0 tabular-nums",
              fresh ? "text-[var(--color-bull)]" : "text-muted-foreground/70",
            )}>
              {formatAge(e.ageMs)}{e.count != null ? ` · ${e.count}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Sidebar({
  markets = [],
  live = false,
  updatedAt = null,
  regime,
  insights = [],
}: SidebarProps) {
  const [devMode, setDevMode] = useDeveloperMode();

  // Self-tick once every 30s for the "Updated Xm ago" label only.
  // Insights rotate every 6s. We deliberately do NOT tick at 1Hz — that
  // re-renders this whole sidebar every second and (via the parent) was
  // contributing to the trade-card flicker on the dashboard.
  const [, setTick] = useState(0);
  // Market-open state is computed client-side after mount to keep SSR and
  // first-render output identical (no hydration mismatch).
  const [marketOpen, setMarketOpen] = useState(false);
  useEffect(() => {
    setMarketOpen(isMarketOpen());
    const id = setInterval(() => {
      setTick((n) => n + 1);
      setMarketOpen(isMarketOpen());
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Rotate insights every ~6s.
  const [insightIdx, setInsightIdx] = useState(0);
  useEffect(() => {
    if (insights.length <= 1) return;
    const id = setInterval(() => setInsightIdx((n) => (n + 1) % insights.length), 6_000);
    return () => clearInterval(id);
  }, [insights.length]);

  // Sticky live state — once observed live, stay live until a hard error.
  const everLive = useRef(false);
  if (live) everLive.current = true;
  const liveSticky = everLive.current || live;

  const commentaryInput: CommentaryInput = {
    spy: markets.find((m) => m.symbol === "SPY"),
    qqq: markets.find((m) => m.symbol === "QQQ"),
    smh: markets.find((m) => m.symbol === "SMH"),
    bias: regime,
  };
  const sectors = sectorStrength(commentaryInput);
  const sent = sentimentScore(commentaryInput);
  const fresh = freshness(updatedAt);
  const insight = insights.length > 0 ? insights[insightIdx % insights.length] : "AI scanning the market…";

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-[var(--color-border)] bg-[var(--color-sidebar)]">
      {/* Logo */}
      <div className="flex h-14 items-center gap-3 border-b border-[var(--color-border)] px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-bull)]/15 ring-1 ring-[var(--color-bull)]/30">
          <div className="h-2.5 w-2.5 rounded-full bg-[var(--color-bull)] animate-pulse-dot" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-none tracking-tight">Momentum AI</div>
          <div className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)]">Options Intelligence</div>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
          {(marketOpen || devMode) && <NavItem {...NAV_LIVE} />}
        </div>

        {/* AI insight panel */}
        <div className="mt-4 rounded-md border border-[var(--color-bull)]/20 bg-[var(--color-bull)]/[0.04] px-2.5 py-2">
          <div className="mb-1 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-[var(--color-bull)]" />
            <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--color-bull)]">AI Insight</span>
          </div>
          <div key={insight} className="animate-fadein text-[11px] leading-snug text-foreground/85">
            {insight}
          </div>
        </div>

        {/* Sector strength */}
        {markets.length > 0 && (() => {
          const anySectorMoved = sectors.some((s) => Math.abs(s.changePct) > 0.0001);
          return (
            <div className="mt-4">
              <div className="mb-1.5 px-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">Sector Strength</div>
              {!anySectorMoved ? (
                <div className="rounded-md border border-dashed border-border/60 bg-card/30 px-2 py-2 text-[10px] leading-snug text-muted-foreground/70">
                  Awaiting live tape — sectors flat or market closed.
                </div>
              ) : (
                <div className="space-y-1 px-1">
                  {sectors.map((s) => (
                    <div key={s.name} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-muted-foreground">{s.name}</span>
                      <div className="flex flex-1 items-center gap-1.5">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/40">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-700",
                              s.changePct > 0 ? "bg-[var(--color-bull)]" : s.changePct < 0 ? "bg-[var(--color-bear)]" : "bg-muted-foreground/40",
                            )}
                            style={{ width: `${Math.min(100, Math.abs(s.changePct) * 60 + 15)}%` }}
                          />
                        </div>
                        <span className={cn(
                          "mono w-10 text-right tabular-nums text-[10px]",
                          s.changePct > 0 ? "text-[var(--color-bull)]"
                          : s.changePct < 0 ? "text-[var(--color-bear)]"
                          : "text-muted-foreground",
                        )}>
                          {s.changePct >= 0 ? "+" : ""}{s.changePct.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Sentiment */}
        {markets.length > 0 && (
          <div className="mt-4 rounded-md border border-border bg-card/40 px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Sentiment</span>
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-wider",
                sent.score >= 60 ? "text-[var(--color-bull)]"
                : sent.score >= 45 ? "text-amber-500"
                : "text-[var(--color-bear)]",
              )}>{sent.label}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-gradient-to-r from-[var(--color-bear)]/40 via-amber-500/40 to-[var(--color-bull)]/40">
              <div
                className="h-full bg-foreground/80 transition-all duration-700"
                style={{ width: "2px", marginLeft: `calc(${sent.score}% - 1px)` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[8px] uppercase tracking-wider text-muted-foreground/60">
              <span>Fear</span><span>Greed</span>
            </div>
          </div>
        )}

        {devMode && (
          <div className="mt-4">
            <div className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">Developer</div>
            <div className="space-y-0.5">
              {NAV_DEV.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </div>
            <SnapshotHealthPanel />
          </div>
        )}
      </nav>

      {/* Market snapshot removed — Market Regime card on the dashboard is the
          single source of truth. Keeping two widgets caused stale/live drift. */}

      {/* Bottom nav */}
      <div className="border-t border-[var(--color-border)] px-3 py-3">
        <div className="space-y-0.5">
          {NAV_BOTTOM.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
          <button
            onClick={() => setDevMode(!devMode)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              devMode
                ? "bg-[var(--color-accent)] text-[var(--color-foreground)]"
                : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/50 hover:text-[var(--color-foreground)]",
            )}
          >
            <Wrench className="h-4 w-4 shrink-0" />
            Developer Mode
            <span className={cn(
              "ml-auto text-[9px] font-bold uppercase tracking-wider",
              devMode ? "text-[var(--color-bull)]" : "text-muted-foreground/40",
            )}>{devMode ? "On" : "Off"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
