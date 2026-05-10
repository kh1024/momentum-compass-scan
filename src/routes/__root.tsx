import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { Sidebar } from "@/components/Sidebar";
import { MOCK_REGIME } from "@/lib/mockData";
import { getQuotes } from "@/lib/quote.functions";

function NotFoundComponent() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="text-center">
        <p className="text-5xl font-bold text-[var(--color-muted-foreground)]">404</p>
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">No setup here.</p>
        <Link
          to="/"
          className="mt-4 inline-block rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="text-center">
        <p className="text-sm font-semibold text-[var(--color-bear)]">Something went wrong</p>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-4 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Momentum Options Scanner" },
      { name: "description", content: "Disciplined AI options scanner — high-quality call & put setups with full Greeks, S/R, and risk plans." },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AppLayout() {
  const fetchQuotes = useServerFn(getQuotes);
  const { data } = useQuery({
    queryKey: ["regime-quotes"],
    queryFn: () => fetchQuotes({ data: { symbols: ["SPY", "QQQ", "SMH"] } }),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.cooldownMs && d.cooldownMs > 0) return Math.min(d.cooldownMs + 1_000, 10 * 60_000);
      return 30_000;
    },
    refetchOnWindowFocus: (q) => !(q.state.data?.cooldownMs && q.state.data.cooldownMs > 0),
    refetchOnMount: false,
    staleTime: 25_000,
    retry: (count, err) => {
      const msg = err instanceof Error ? err.message : "";
      if (/rate.?limit|429/i.test(msg)) return false;
      return count < 1;
    },
  });

  const live = data?.live ?? false;
  const spyQ = data?.quotes?.SPY;
  const qqqQ = data?.quotes?.QQQ;
  const smhQ = data?.quotes?.SMH;

  function trendOf(pct: number): "Up" | "Down" | "Flat" {
    if (pct > 0.1) return "Up";
    if (pct < -0.1) return "Down";
    return "Flat";
  }

  const markets = [
    {
      symbol: "SPY",
      price: spyQ?.price ?? MOCK_REGIME.spy.price,
      changePct: spyQ?.changePct ?? MOCK_REGIME.spy.changePct,
      trend: spyQ ? trendOf(spyQ.changePct) : MOCK_REGIME.spy.trend,
    },
    {
      symbol: "QQQ",
      price: qqqQ?.price ?? MOCK_REGIME.qqq.price,
      changePct: qqqQ?.changePct ?? MOCK_REGIME.qqq.changePct,
      trend: qqqQ ? trendOf(qqqQ.changePct) : MOCK_REGIME.qqq.trend,
    },
    {
      symbol: "SMH",
      price: smhQ?.price ?? MOCK_REGIME.smh.price,
      changePct: smhQ?.changePct ?? MOCK_REGIME.smh.changePct,
      trend: smhQ ? trendOf(smhQ.changePct) : MOCK_REGIME.smh.trend,
    },
  ];

  return (
    <div className="flex min-h-screen">
      <Sidebar markets={markets} live={live} regime={MOCK_REGIME.bias} />
      <div className="flex flex-1 flex-col pl-56">
        <main className="flex-1">
          <Outlet />
        </main>
        <footer className="border-t border-[var(--color-border)] px-6 py-3 text-[11px] text-[var(--color-muted-foreground)]">
          Options involve substantial risk. For education and planning only — verify all data in your broker before placing trades.
        </footer>
      </div>
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AppLayout />
      <Toaster position="bottom-right" theme="dark" />
    </QueryClientProvider>
  );
}
