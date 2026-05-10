import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Dashboard" },
  { to: "/scanner", label: "Scanner" },
  { to: "/patterns", label: "Patterns" },
  { to: "/watchlist", label: "Watchlist" },
  { to: "/performance", label: "Performance" },
  { to: "/api-health", label: "API Health" },
  { to: "/settings", label: "Settings" },
] as const;

export function NavBar() {
  const { location } = useRouterState();
  return (
    <header className="border-b border-border/60 bg-background">
      <div className="mx-auto flex max-w-7xl items-center gap-0 px-4 py-0">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-3 py-2.5 pr-6 border-r border-border/40">
          <div className="flex flex-col items-center justify-center h-6 w-6">
            <div className="h-3 w-3 rounded-full bg-[var(--color-bull)]" />
          </div>
          <div className="leading-none">
            <div className="text-xs font-bold tracking-tight text-foreground uppercase">Momentum Scanner</div>
            <div className="text-[9px] tracking-widest text-muted-foreground/60 uppercase mt-0.5">Options · AI · Discipline</div>
          </div>
        </Link>

        {/* Nav items */}
        <nav className="flex items-stretch">
          {items.map((i) => {
            const active = i.to === "/" ? location.pathname === "/" : location.pathname.startsWith(i.to);
            return (
              <Link
                key={i.to}
                to={i.to}
                className={cn(
                  "relative flex items-center px-4 py-3 text-[11px] font-semibold uppercase tracking-widest transition-colors",
                  active
                    ? "text-[var(--color-bull)] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-bull)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {i.label}
              </Link>
            );
          })}
        </nav>

        {/* Right side status */}
        <div className="ml-auto flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-bull)] animate-pulse" />
            <span className="uppercase tracking-widest">Live</span>
          </span>
        </div>
      </div>
    </header>
  );
}

export function Disclaimer() {
  return (
    <footer className="mt-12 border-t border-border/40 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-3 text-[10px] uppercase tracking-wider text-muted-foreground/50">
        ⚠ Options involve substantial risk. For education and planning only — verify all data in your broker before placing trades.
      </div>
    </footer>
  );
}
