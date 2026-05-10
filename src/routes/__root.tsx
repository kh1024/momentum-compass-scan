import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { Disclaimer } from "@/components/NavBar";
import { Sidebar } from "@/components/Sidebar";
import { MOCK_REGIME } from "@/lib/mockData";

const SIDEBAR_MARKETS = [
  { symbol: "SPY", price: MOCK_REGIME.spy.price, changePct: MOCK_REGIME.spy.changePct, trend: MOCK_REGIME.spy.trend },
  { symbol: "QQQ", price: MOCK_REGIME.qqq.price, changePct: MOCK_REGIME.qqq.changePct, trend: MOCK_REGIME.qqq.trend },
  { symbol: "SMH", price: MOCK_REGIME.smh.price, changePct: MOCK_REGIME.smh.changePct, trend: MOCK_REGIME.smh.trend },
];

function NotFoundComponent() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">No setup here. Try the scanner.</p>
        <Link to="/" className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Go home</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something broke loading this page</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >Try again</button>
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
      { name: "description", content: "Disciplined AI options scanner: high-quality call & put setups with full Greeks, S/R, and risk plans." },
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

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background text-foreground">
        <Sidebar markets={SIDEBAR_MARKETS} live={!MOCK_REGIME.isDemo} regime={MOCK_REGIME.bias} />
        <main className="pl-56">
          <div className="mx-auto max-w-7xl px-4 py-6">
            <Outlet />
          </div>
        </main>
        <Disclaimer />
      </div>
    </QueryClientProvider>
  );
}
