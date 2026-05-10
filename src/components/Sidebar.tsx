import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Zap, Star, Settings, ChevronRight, Wrench,
  TrendingUp, Activity, ScanSearch, FlaskConical, Wifi, Radio, Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import { freshness, sectorStrength, sentimentScore, type CommentaryInput } from "@/lib/aiCommentary";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Daily Picks" },
  { to: "/live", icon: Zap, label: "Live" },
  { to: "/watchlist", icon: Star, label: "Watchlist" },
] as const;

const NAV_DEV = [
  { to: "/scanner", icon: ScanSearch, label: "Scanner" },
  { to: "/performance", icon: TrendingUp, label: "Performance" },
  { to: "/patterns", icon: Activity, label: "Patterns" },
  { to: "/io-data", icon: FlaskConical, label: "Data Inspector" },
  { to: "/api-health", icon: Wifi, label: "API Health" },
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

export function Sidebar({
  markets = [],
  live = false,
  updatedAt = null,
  regime,
  insights = [],
}: SidebarProps) {
  const [devMode, setDevMode] = useDeveloperMode();

  // Ticker for "Xs ago" + insight rotation.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  // Rotate insights every ~6s.
  const [insightIdx, setInsightIdx] = useState(0);
  useEffect(() => {
    if (insights.length <= 1) return;
    const id = setInterval(() => setInsightIdx((n) => (n + 1) % insights.length), 6_000);
    return () => clearInterval(id);
  }, [insights.length]);

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
        {markets.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 px-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">Sector Strength</div>
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
          </div>
        )}

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
          </div>
        )}
      </nav>

      {/* Market snapshot */}
      {markets.length > 0 && (
        <div className="border-t border-[var(--color-border)] px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted-foreground)]">Market</span>
            <span
              className={cn(
                "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider",
                live ? "text-[var(--color-bull)]" : "text-amber-500",
              )}
              title={live ? `Live · updated ${fresh}` : `Last update ${fresh}`}
            >
              <Radio className={cn("h-2.5 w-2.5", live && "animate-pulse-dot")} />
              {live ? "Live" : "Stale"}
            </span>
          </div>
          <div className="space-y-1">
            {markets.map((m) => (
              <div key={m.symbol} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-[var(--color-muted-foreground)]">{m.symbol}</span>
                <FlashPrice value={m.price} />
                <span
                  className={cn(
                    "mono w-14 text-right text-[10px] tabular-nums",
                    m.changePct > 0 ? "text-[var(--color-bull)]"
                    : m.changePct < 0 ? "text-[var(--color-bear)]"
                    : "text-[var(--color-muted-foreground)]",
                  )}
                >
                  {m.changePct >= 0 ? "+" : ""}{m.changePct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 text-right text-[9px] text-muted-foreground/60">Updated {fresh}</div>
          {regime && (
            <div className={cn(
              "mt-2 rounded px-2 py-1 text-center text-[10px] font-bold uppercase tracking-widest",
              regime === "Risk-on" ? "bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
              : regime === "Risk-off" ? "bg-[var(--color-bear)]/10 text-[var(--color-bear)]"
              : "bg-[var(--color-watch)]/10 text-[var(--color-watch)]",
            )}>
              {regime === "Risk-on" ? "Risk On" : regime === "Risk-off" ? "Risk Off" : "Neutral"}
            </div>
          )}
        </div>
      )}

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
