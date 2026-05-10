import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sidebar } from "@/components/Sidebar";
import { MOCK_REGIME } from "@/lib/mockData";
import { getQuotes } from "@/lib/quote.functions";
import { aiInsights } from "@/lib/aiCommentary";

function trendOf(pct: number): "Up" | "Down" | "Flat" {
  if (pct > 0.1) return "Up";
  if (pct < -0.1) return "Down";
  return "Flat";
}

// NavBar renders the fixed left sidebar and injects a CSS override that
// pushes Lovable's <main> wrapper (mx-auto max-w-7xl) out of the sidebar's way.
// This file is not overwritten by Lovable's sync so the sidebar persists
// regardless of what __root.tsx contains.
export function NavBar() {
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

  useEffect(() => {
    const id = "sidebar-layout-override";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = `
      /* ── Layout: push content right of 224px sidebar ── */
      body main, body > div > main {
        padding-left: 224px !important;
        max-width: 100% !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        padding-right: 0 !important;
        padding-top: 0 !important;
        padding-bottom: 0 !important;
      }
      body > div > div.pl-56 { padding-left: 224px !important; }

      /* ── Design tokens: dark trading terminal ── */
      :root {
        --background: #09090b;
        --foreground: #fafafa;
        --card: #111113;
        --card-foreground: #fafafa;
        --border: #27272a;
        --input: #27272a;
        --primary: #10b981;
        --primary-foreground: #030712;
        --muted: #18181b;
        --muted-foreground: #71717a;
        --accent: #18181b;
        --accent-foreground: #fafafa;
        --popover: #111113;
        --popover-foreground: #fafafa;
        --sidebar: #0c0c0e;
        --color-bull: #10b981;
        --color-buy-now: #10b981;
        --color-bear: #ef4444;
        --color-watch: #f59e0b;
        --color-lotto: #8b5cf6;
        --color-accent: #18181b;
        --color-border: #27272a;
        --color-foreground: #fafafa;
        --color-muted-foreground: #71717a;
        --color-sidebar: #0c0c0e;
        --radius: 0.5rem;
      }

      /* ── Global reset to terminal feel ── */
      body { background: #09090b !important; color: #fafafa !important; font-family: 'Inter', system-ui, sans-serif !important; }

      /* ── Page content wrapper ── */
      body main > div, body > div > div.pl-56 > main > div {
        padding: 24px 28px !important;
        max-width: 100% !important;
      }

      /* ── Cards: flat dark with sharp border ── */
      .rounded-xl, .rounded-lg, .rounded-md {
        border-radius: 6px !important;
      }
      [class*="bg-card"] { background: #111113 !important; }
      [class*="border-border"] { border-color: #27272a !important; }

      /* ── Trade cards: terminal row style ── */
      [class*="CompactTradeCard"], .group.relative.overflow-hidden {
        border-radius: 4px !important;
        border-color: #1f1f23 !important;
      }
      .group.relative.overflow-hidden:hover {
        border-color: #3f3f46 !important;
        background: #16161a !important;
      }

      /* ── Scanner table: terminal aesthetics ── */
      table { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace !important; font-size: 11px !important; }
      thead th { background: #0f0f11 !important; color: #52525b !important; letter-spacing: 0.08em !important; font-size: 9px !important; text-transform: uppercase !important; padding: 6px 8px !important; }
      tbody tr { border-color: #1c1c1f !important; }
      tbody tr:hover { background: #16161a !important; }
      tbody td { padding: 5px 8px !important; }

      /* ── Stat cards: compact and sharp ── */
      .grid [class*="rounded"] { border-radius: 4px !important; }

      /* ── Buttons ── */
      button[class*="bg-foreground"], button[class*="bg-primary"] {
        background: #10b981 !important;
        color: #030712 !important;
        border-color: #10b981 !important;
        border-radius: 4px !important;
        font-weight: 700 !important;
        font-size: 11px !important;
        letter-spacing: 0.04em !important;
      }
      button[class*="bg-background"], button[class*="bg-card"], button[class*="border-border"] {
        background: #111113 !important;
        border-color: #27272a !important;
        border-radius: 4px !important;
        color: #71717a !important;
        font-size: 11px !important;
      }
      button[class*="border-border"]:hover { border-color: #3f3f46 !important; color: #fafafa !important; }

      /* ── Headings ── */
      h1 { font-size: 18px !important; font-weight: 700 !important; letter-spacing: -0.025em !important; color: #fafafa !important; }
      h2 { font-size: 11px !important; font-weight: 600 !important; letter-spacing: 0.08em !important; text-transform: uppercase !important; color: #52525b !important; }

      /* ── Inputs / selects ── */
      input, select {
        background: #0f0f11 !important;
        border-color: #27272a !important;
        border-radius: 4px !important;
        color: #fafafa !important;
        font-size: 11px !important;
      }
      input:focus, select:focus { outline: none !important; border-color: #10b981 !important; box-shadow: 0 0 0 1px #10b981 !important; }

      /* ── Filter chips ── */
      button[class*="rounded-full"], button[class*="rounded-md"][class*="border"] {
        font-size: 10px !important;
        font-weight: 600 !important;
        letter-spacing: 0.03em !important;
      }

      /* ── Score numbers: mono ── */
      [class*="tabular-nums"] { font-family: ui-monospace, monospace !important; }

      /* ── Tabs ── */
      [role="tablist"] { background: #0f0f11 !important; border-radius: 6px !important; border: 1px solid #27272a !important; padding: 3px !important; }
      [role="tab"] { border-radius: 4px !important; font-size: 11px !important; font-weight: 500 !important; color: #71717a !important; }
      [role="tab"][data-state="active"] { background: #1f1f23 !important; color: #fafafa !important; }

      /* ── Drawer / sheet ── */
      [data-radix-popper-content-wrapper], [class*="SheetContent"] {
        background: #111113 !important;
        border-color: #27272a !important;
      }

      /* ── Scrollbar: minimal ── */
      ::-webkit-scrollbar { width: 4px; height: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }
      ::-webkit-scrollbar-thumb:hover { background: #52525b; }

      /* ── Pulse animation for live dot ── */
      @keyframes pulse-dot { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      .animate-pulse-dot { animation: pulse-dot 2s ease-in-out infinite !important; }
    `;
    document.head.appendChild(el);
  }, []);

  const live = data?.live ?? false;
  const spyQ = data?.quotes?.SPY;
  const qqqQ = data?.quotes?.QQQ;
  const smhQ = data?.quotes?.SMH;

  const markets = [
    {
      symbol: "SPY",
      price: spyQ?.price ?? MOCK_REGIME.spy.price,
      changePct: spyQ?.changePct ?? MOCK_REGIME.spy.changePct,
      trend: spyQ ? trendOf(spyQ.changePct) : MOCK_REGIME.spy.trend,
      sources: spyQ ? Object.keys(spyQ.sources ?? {}) : [],
      agreement: spyQ?.agreement,
    },
    {
      symbol: "QQQ",
      price: qqqQ?.price ?? MOCK_REGIME.qqq.price,
      changePct: qqqQ?.changePct ?? MOCK_REGIME.qqq.changePct,
      trend: qqqQ ? trendOf(qqqQ.changePct) : MOCK_REGIME.qqq.trend,
      sources: qqqQ ? Object.keys(qqqQ.sources ?? {}) : [],
      agreement: qqqQ?.agreement,
    },
    {
      symbol: "SMH",
      price: smhQ?.price ?? MOCK_REGIME.smh.price,
      changePct: smhQ?.changePct ?? MOCK_REGIME.smh.changePct,
      trend: smhQ ? trendOf(smhQ.changePct) : MOCK_REGIME.smh.trend,
      sources: smhQ ? Object.keys(smhQ.sources ?? {}) : [],
      agreement: smhQ?.agreement,
    },
  ];

  return <Sidebar markets={markets} live={live} regime={MOCK_REGIME.bias} />;
}

export function Disclaimer() {
  return null;
}
