import { useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
// MOCK_REGIME no longer used — sidebar runs on live data only.
import { aiInsights } from "@/lib/aiCommentary";
import { isMarketOpen } from "@/lib/marketHours";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";

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
  const quoteRefreshIntervalMs = isMarketOpen() ? 30_000 : 24 * 60 * 60_000;
  const { get: getLive, anyLive } = useLiveQuotes(["SPY", "QQQ", "SMH"], { refetchIntervalMs: quoteRefreshIntervalMs });

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

      /* ── Fade-in for rotating insights ── */
      @keyframes fadein { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
      .animate-fadein { animation: fadein 350ms ease-out !important; }

      /* ── Marquee for live ticker ── */
      @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      .animate-marquee { animation: marquee 45s linear infinite; }
    `;
    document.head.appendChild(el);
  }, []);

  const spyQ = getLive("SPY");
  const qqqQ = getLive("QQQ");
  const smhQ = getLive("SMH");

  const markets = [
    spyQ ? { symbol: "SPY", price: spyQ.price, changePct: spyQ.changePct, trend: trendOf(spyQ.changePct) } : null,
    qqqQ ? { symbol: "QQQ", price: qqqQ.price, changePct: qqqQ.changePct, trend: trendOf(qqqQ.changePct) } : null,
    smhQ ? { symbol: "SMH", price: smhQ.price, changePct: smhQ.changePct, trend: trendOf(smhQ.changePct) } : null,
  ].filter((m): m is NonNullable<typeof m> => m !== null);

  const updatedAt = Math.max(spyQ?.ts ?? 0, qqqQ?.ts ?? 0, smhQ?.ts ?? 0) || null;

  // Derive bias from live data only — never fall back to mock.
  const live = [spyQ, qqqQ, smhQ].filter((q): q is NonNullable<typeof q> => !!q);
  const avgChange = live.length > 0 ? live.reduce((a, b) => a + b.changePct, 0) / live.length : 0;
  const bias = live.length === 0 ? undefined
    : avgChange > 0.3 ? "Risk-on"
    : avgChange < -0.3 ? "Risk-off"
    : "Neutral";

  const insights = live.length > 0
    ? aiInsights({
        spy: spyQ ? { symbol: "SPY", changePct: spyQ.changePct } : undefined,
        qqq: qqqQ ? { symbol: "QQQ", changePct: qqqQ.changePct } : undefined,
        smh: smhQ ? { symbol: "SMH", changePct: smhQ.changePct } : undefined,
        bias,
      })
    : ["Waiting for live market data…"];

  return (
    <Sidebar
      markets={markets}
      live={anyLive}
      updatedAt={updatedAt}
      regime={bias}
      insights={insights}
    />
  );
}

export function Disclaimer() {
  return null;
}
