import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sidebar } from "@/components/Sidebar";
import { MOCK_REGIME } from "@/lib/mockData";
import { getQuotes } from "@/lib/quote.functions";

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
    // Override Lovable's `mx-auto max-w-7xl px-4 py-6` on <main> so content
    // sits to the right of the 224px fixed sidebar.
    el.textContent = `
      body main {
        padding-left: 224px !important;
        max-width: 100% !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        padding-right: 0 !important;
        padding-top: 0 !important;
        padding-bottom: 0 !important;
      }
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

  return <Sidebar markets={markets} live={live} regime={MOCK_REGIME.bias} />;
}

export function Disclaimer() {
  return null;
}
