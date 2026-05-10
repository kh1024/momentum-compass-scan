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
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-[var(--color-bull)]/20 ring-1 ring-[var(--color-bull)]/40" />
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight">Momentum Options Scanner</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Education only · Verify in broker</div>
          </div>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          {items.map(i => {
            const active = i.to === "/" ? location.pathname === "/" : location.pathname.startsWith(i.to);
            return (
              <Link
                key={i.to}
                to={i.to}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                {i.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export function Disclaimer() {
  return (
    <footer className="mt-12 border-t border-border bg-background/60">
      <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-muted-foreground">
        ⚠ Options are risky. This scanner is for education and trade planning only. Always verify live option-chain data in your broker before entering.
      </div>
    </footer>
  );
}
