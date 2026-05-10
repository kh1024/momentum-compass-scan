import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Zap, Star, Settings, ChevronRight, Wrench,
  TrendingUp, Activity, ScanSearch, FlaskConical, Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";

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

interface SidebarMarket {
  symbol: string;
  price: number;
  changePct: number;
  trend: "Up" | "Down" | "Flat";
  sources?: string[];
  agreement?: "verified" | "close" | "mismatch" | "single";
}

interface SidebarProps {
  markets?: SidebarMarket[];
  live?: boolean;
  regime?: string;
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

export function Sidebar({ markets = [], live = false, regime }: SidebarProps) {
  const [devMode, setDevMode] = useDeveloperMode();
  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-[var(--color-border)] bg-[var(--color-sidebar)]">
      {/* Logo */}
      <div className="flex h-14 items-center gap-3 border-b border-[var(--color-border)] px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-bull)]/15 ring-1 ring-[var(--color-bull)]/30">
          <div className="h-2.5 w-2.5 rounded-full bg-[var(--color-bull)]" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-none tracking-tight">Momentum AI</div>
          <div className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)]">Options Scanner</div>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>
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
            <span className={cn(
              "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider",
              live ? "text-[var(--color-bull)]" : "text-[var(--color-muted-foreground)]",
            )}>
              <span className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                live ? "bg-[var(--color-bull)] animate-pulse-dot" : "bg-[var(--color-muted-foreground)]",
              )} />
              {live ? "Live" : "Demo"}
            </span>
          </div>
          <div className="space-y-1">
            {markets.map((m) => (
              <div key={m.symbol} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-[var(--color-muted-foreground)]">{m.symbol}</span>
                <span className="mono ml-auto font-semibold text-[var(--color-foreground)]">
                  ${m.price.toFixed(2)}
                </span>
                <span
                  className={cn(
                    "mono w-14 text-right text-[10px]",
                    m.trend === "Up" ? "text-[var(--color-bull)]"
                    : m.trend === "Down" ? "text-[var(--color-bear)]"
                    : "text-[var(--color-muted-foreground)]",
                  )}
                >
                  {m.changePct >= 0 ? "+" : ""}{m.changePct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
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
