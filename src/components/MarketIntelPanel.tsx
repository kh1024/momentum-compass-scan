import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMarketNews } from "@/lib/marketNews.functions";
import { cn } from "@/lib/utils";
import { ExternalLink, Newspaper, RefreshCw, TrendingUp } from "lucide-react";

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function MarketIntelPanel() {
  const fetchNews = useServerFn(getMarketNews);
  const { data, isFetching, refetch, isError } = useQuery({
    queryKey: ["market-news"],
    queryFn: () => fetchNews(),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const items = data?.items ?? [];
  const headline = data?.headline ?? "Loading market intelligence…";
  const summary = data?.summary ?? "Pulling live headlines from the web.";

  return (
    <section className="rounded-xl border border-border bg-card/60 backdrop-blur">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20">
            <Newspaper className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <span>Market Intelligence</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
                <span className="h-1 w-1 rounded-full bg-emerald-400" /> LIVE
              </span>
            </div>
            <div className="truncate text-sm font-semibold text-foreground">
              {headline}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {data?.fetchedAt && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {timeAgo(data.fetchedAt)}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/60 text-muted-foreground transition hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
            title="Refresh market news"
            aria-label="Refresh market news"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </button>
        </div>
      </header>

      <div className="px-4 py-3">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="leading-relaxed">{summary}</p>
        </div>

        {items.length > 0 ? (
          <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {items.map((it) => (
              <li key={it.url}>
                <a
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex h-full flex-col gap-1 rounded-lg border border-border/60 bg-background/40 px-3 py-2 transition hover:border-primary/40 hover:bg-background/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                      {it.source || "news"}
                    </span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground transition group-hover:text-primary" />
                  </div>
                  <div className="line-clamp-2 text-xs font-medium text-foreground/90 group-hover:text-foreground">
                    {it.title}
                  </div>
                  {it.snippet && (
                    <div className="line-clamp-2 text-[11px] text-muted-foreground">
                      {it.snippet}
                    </div>
                  )}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-[11px] text-muted-foreground">
            {isFetching
              ? "Fetching the latest market headlines…"
              : isError || data?.error
                ? "Live news feed unavailable. Try refreshing in a moment."
                : "No headlines available right now."}
          </div>
        )}
      </div>
    </section>
  );
}
