import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMarketNews, type MarketNewsItem } from "@/lib/marketNews.functions";
import { cn } from "@/lib/utils";
import { ExternalLink, Newspaper, RefreshCw, SlidersHorizontal, TrendingUp } from "lucide-react";

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

// ── Filter model ────────────────────────────────────────────────────────────

type CategoryKey = "earnings" | "fed" | "sector";

interface CategoryDef {
  key: CategoryKey;
  label: string;
  /** Words that trigger this category (case-insensitive). */
  patterns: RegExp[];
}

const CATEGORIES: CategoryDef[] = [
  {
    key: "earnings",
    label: "Earnings",
    patterns: [
      /\bearnings?\b/i,
      /\bguidance\b/i,
      /\b(beats?|misses?|tops?)\s+(estimates?|forecast)/i,
      /\b(revenue|profit|eps)\b/i,
      /\bquarterly\b/i,
    ],
  },
  {
    key: "fed",
    label: "Fed / Macro",
    patterns: [
      /\bfed(eral reserve)?\b/i,
      /\bpowell\b/i,
      /\bfomc\b/i,
      /\b(interest )?rate(s| cut| hike| decision)?\b/i,
      /\binflation\b/i,
      /\bcpi\b/i,
      /\bjobs report\b/i,
      /\bunemployment\b/i,
      /\btreasur(y|ies)\b/i,
      /\byield(s)?\b/i,
    ],
  },
  {
    key: "sector",
    label: "Sector Movers",
    patterns: [
      /\b(tech|technology|semiconductor|chips?|ai)\b/i,
      /\b(energy|oil|crude|gas)\b/i,
      /\b(bank(s|ing)?|financial(s)?)\b/i,
      /\b(health(care)?|pharma|biotech)\b/i,
      /\b(retail|consumer)\b/i,
      /\b(industrial(s)?|defense)\b/i,
      /\b(real estate|reit(s)?)\b/i,
      /\bsector\b/i,
      /\b(surge|plunge|rally|slide|jump|tumble|soar)s?\b/i,
    ],
  },
];

interface ScoredItem extends MarketNewsItem {
  categories: CategoryKey[];
  /** 0-100 relevance/confidence score. */
  confidence: number;
}

function scoreItem(item: MarketNewsItem): ScoredItem {
  const title = item.title || "";
  const snippet = item.snippet || "";
  const cats: CategoryKey[] = [];
  let raw = 0;
  for (const cat of CATEGORIES) {
    let hit = false;
    for (const re of cat.patterns) {
      if (re.test(title)) {
        raw += 30;
        hit = true;
      } else if (re.test(snippet)) {
        raw += 12;
        hit = true;
      }
    }
    if (hit) cats.push(cat.key);
  }
  // Recency bonus — headlines fresher than 6h get extra weight.
  if (item.publishedAt) {
    const t = new Date(item.publishedAt).getTime();
    if (Number.isFinite(t)) {
      const ageH = (Date.now() - t) / 3_600_000;
      if (ageH < 1) raw += 15;
      else if (ageH < 6) raw += 8;
      else if (ageH < 24) raw += 3;
    }
  }
  // Cross-category match bonus.
  if (cats.length >= 2) raw += 10;
  const confidence = Math.max(0, Math.min(100, raw));
  return { ...item, categories: cats, confidence };
}

// ── Persisted filter state ──────────────────────────────────────────────────

interface FilterState {
  enabled: Record<CategoryKey, boolean>;
  minConfidence: number;
}

const STORAGE_KEY = "market-intel:filters:v1";
const DEFAULT_FILTERS: FilterState = {
  enabled: { earnings: true, fed: true, sector: true },
  minConfidence: 0,
};

function loadFilters(): FilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<FilterState>;
    return {
      enabled: { ...DEFAULT_FILTERS.enabled, ...(parsed.enabled ?? {}) },
      minConfidence:
        typeof parsed.minConfidence === "number"
          ? Math.max(0, Math.min(100, parsed.minConfidence))
          : 0,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(state: FilterState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export function MarketIntelPanel() {
  const [mounted, setMounted] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    setMounted(true);
    setFilters(loadFilters());
  }, []);

  useEffect(() => {
    if (mounted) saveFilters(filters);
  }, [filters, mounted]);

  const fetchNews = useServerFn(getMarketNews);
  const { data, isFetching, refetch, isError } = useQuery({
    queryKey: ["market-news"],
    queryFn: () => fetchNews(),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: mounted,
  });

  const scored = useMemo<ScoredItem[]>(
    () => (data?.items ?? []).map(scoreItem),
    [data?.items],
  );

  const filtered = useMemo(() => {
    const activeCats = (Object.keys(filters.enabled) as CategoryKey[]).filter(
      (k) => filters.enabled[k],
    );
    const allOff = activeCats.length === 0;
    return scored
      .filter((it) => {
        if (it.confidence < filters.minConfidence) return false;
        // If user has at least one category enabled, require a match.
        // If all categories are off, show every item that meets confidence.
        if (allOff) return true;
        if (it.categories.length === 0) return false;
        return it.categories.some((c) => filters.enabled[c]);
      })
      .sort((a, b) => b.confidence - a.confidence);
  }, [scored, filters]);

  const topHeadline = filtered[0] ?? scored[0];
  const headline = topHeadline?.title ?? data?.headline ?? "Loading market intelligence…";
  const summary =
    filtered.slice(0, 3).map((i) => i.title).join(" · ") ||
    data?.summary ||
    "Live market headlines updated throughout the session.";

  const toggleCat = (k: CategoryKey) =>
    setFilters((f) => ({ ...f, enabled: { ...f.enabled, [k]: !f.enabled[k] } }));

  if (!mounted) {
    return (
      <section className="rounded-xl border border-border bg-card/60 backdrop-blur">
        <div className="flex items-center gap-2 px-4 py-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <Newspaper className="h-3.5 w-3.5 text-primary" />
          Market Intelligence
        </div>
        <div className="px-4 pb-4 text-xs text-muted-foreground">Loading market intelligence…</div>
      </section>
    );
  }

  const hiddenCount = scored.length - filtered.length;

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
        <div className="flex items-center gap-2 shrink-0">
          {data?.fetchedAt && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {timeAgo(data.fetchedAt)}
            </span>
          )}
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] font-medium transition",
              showFilters
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background/60 text-muted-foreground hover:text-foreground hover:border-foreground/30",
            )}
            title="Filter headlines"
          >
            <SlidersHorizontal className="h-3 w-3" />
            Filters
          </button>
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

      {showFilters && (
        <div className="space-y-3 border-b border-border/60 bg-background/30 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Topics
            </span>
            {CATEGORIES.map((c) => {
              const on = filters.enabled[c.key];
              return (
                <button
                  key={c.key}
                  onClick={() => toggleCat(c.key)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition",
                    on
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground shrink-0">
              Min confidence
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={filters.minConfidence}
              onChange={(e) =>
                setFilters((f) => ({ ...f, minConfidence: Number(e.target.value) }))
              }
              className="flex-1 accent-primary"
              aria-label="Minimum confidence score"
            />
            <span className="mono w-12 text-right text-[11px] tabular-nums text-foreground/80">
              {filters.minConfidence}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              Showing {filtered.length} of {scored.length}
              {hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
            </span>
            <button
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="rounded px-2 py-0.5 text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="leading-relaxed">{summary}</p>
        </div>

        {filtered.length > 0 ? (
          <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {filtered.map((it) => (
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
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={cn(
                          "mono rounded px-1.5 py-0.5 text-[9px] font-semibold tabular-nums",
                          it.confidence >= 60
                            ? "bg-emerald-500/15 text-emerald-400"
                            : it.confidence >= 30
                              ? "bg-amber-500/15 text-amber-400"
                              : "bg-muted/40 text-muted-foreground",
                        )}
                        title="Relevance score"
                      >
                        {it.confidence}
                      </span>
                      <ExternalLink className="h-3 w-3 text-muted-foreground transition group-hover:text-primary" />
                    </div>
                  </div>
                  <div className="line-clamp-2 text-xs font-medium text-foreground/90 group-hover:text-foreground">
                    {it.title}
                  </div>
                  {it.snippet && (
                    <div className="line-clamp-2 text-[11px] text-muted-foreground">
                      {it.snippet}
                    </div>
                  )}
                  {it.categories.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {it.categories.map((c) => {
                        const def = CATEGORIES.find((d) => d.key === c);
                        return (
                          <span
                            key={c}
                            className="rounded-full border border-border/60 px-1.5 py-0 text-[9px] uppercase tracking-wider text-muted-foreground"
                          >
                            {def?.label}
                          </span>
                        );
                      })}
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
                : scored.length > 0
                  ? "No headlines match your filters. Lower the confidence or enable more topics."
                  : "No headlines available right now."}
          </div>
        )}
      </div>
    </section>
  );
}
