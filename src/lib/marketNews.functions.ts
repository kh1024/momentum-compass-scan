import { createServerFn } from "@tanstack/react-start";

export type MarketNewsItem = {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt?: string;
};

export type MarketNewsResponse = {
  headline: string;
  summary: string;
  items: MarketNewsItem[];
  fetchedAt: number;
  error: string | null;
};

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const getMarketNews = createServerFn({ method: "GET" }).handler(
  async (): Promise<MarketNewsResponse> => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return {
        headline: "Market intelligence unavailable",
        summary: "News provider is not configured.",
        items: [],
        fetchedAt: Date.now(),
        error: "FIRECRAWL_API_KEY missing",
      };
    }

    try {
      const res = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query:
            "site:reuters.com (markets OR stocks OR S&P OR Nasdaq OR Fed OR earnings)",
          limit: 10,
          tbs: "qdr:d",
          sources: ["news", "web"],
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          headline: "Market intelligence temporarily unavailable",
          summary: "Could not retrieve live market news.",
          items: [],
          fetchedAt: Date.now(),
          error: `Firecrawl ${res.status}: ${text.slice(0, 200)}`,
        };
      }

      const json: any = await res.json();
      const raw: any[] =
        json?.data?.news ??
        json?.data?.web ??
        json?.data ??
        json?.results ??
        [];

      const items: MarketNewsItem[] = raw
        .map((r: any) => ({
          title: String(r.title || r.name || "").trim(),
          url: String(r.url || r.link || ""),
          source: String(r.source || hostFromUrl(r.url || r.link || "")),
          snippet: String(r.description || r.snippet || r.text || "").trim(),
          publishedAt: r.date || r.publishedAt || r.published_date,
        }))
        .filter((i) => i.title && i.url)
        .slice(0, 6);

      const top = items[0];
      const headline = top?.title ?? "Markets in focus";
      const summary =
        items
          .slice(0, 3)
          .map((i) => i.title)
          .join(" · ") || "Live market headlines updated throughout the session.";

      return {
        headline,
        summary,
        items,
        fetchedAt: Date.now(),
        error: null,
      };
    } catch (err: any) {
      return {
        headline: "Market intelligence temporarily unavailable",
        summary: "Live news feed could not be reached.",
        items: [],
        fetchedAt: Date.now(),
        error: err?.message || "unknown error",
      };
    }
  },
);
