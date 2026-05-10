/**
 * Multi-subreddit Reddit signal pipeline — server-only.
 *
 * Source: Apewisdom (free, no key) aggregates Reddit mentions across many
 * subreddits via /api/v1.0/filter/<sub>. We fetch each in parallel, merge per
 * ticker, then classify the top names with Lovable AI (with a heuristic
 * fallback if the gateway is unavailable / rate-limited).
 *
 * Cache: 20 min in-memory.
 */

import { fetchWithRetry } from "./fetchRetry.server";

// Apewisdom supports these subreddit filters (other subs the user listed
// — swingtrading, valueinvesting, thetagang, optionswheel — return 404
// on Apewisdom and are silently skipped).
const SUBREDDITS = [
  "wallstreetbets",
  "stocks",
  "investing",
  "options",
  "stockmarket",
  "daytrading",
  "robinhood",
] as const;
type SubKey = (typeof SUBREDDITS)[number];

const APEWISDOM_BASE = "https://apewisdom.io/api/v1.0/filter";
const CACHE_TTL_MS = 20 * 60_000;
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

export type TrendingCategory =
  | "Trending"
  | "Bullish Momentum"
  | "Bearish Momentum"
  | "Options Hype"
  | "Lottery Watch"
  | "Contrarian Watch"
  | "Too Much Hype";

export type TrendingSentiment = "Bullish" | "Bearish" | "Mixed" | "Hype" | "Neutral";

export interface RedditTrendingEntry {
  ticker: string;
  mentions: number;          // total across subs
  mentions24hAgo: number;
  mentionsDelta: number;     // mentions - mentions24hAgo
  mentionsDeltaPct: number;  // (mentions - prev) / max(prev,1)
  upvotes: number;
  bestRank: number;          // lowest rank across subs (lower = better)
  rankDelta: number;         // 24h_ago_rank - rank (positive = climbing)
  trend: "Rising" | "Flat" | "Falling";
  sources: SubKey[];
  topSource: SubKey;
  sentiment: TrendingSentiment;
  bullishRatio: number;      // 0..1, derived (heuristic if no AI)
  category: TrendingCategory;
  /** One-line AI interpretation for the UI. */
  interpretation: string;
  /** Free-form short narrative themes (e.g. ["earnings", "AI"]). */
  themes: string[];
  /** True if AI suggested the discussion is option-related. */
  optionsFocus: boolean;
  /** Risk badge — surfaced on the card. */
  riskNote: string | null;
  classifiedBy: "ai" | "heuristic";
}

export interface RedditTrendingResult {
  entries: RedditTrendingEntry[];
  fetchedAt: number;
  sourcesUsed: SubKey[];
  sourcesFailed: SubKey[];
  aiAvailable: boolean;
  error?: string;
}

interface ApewisdomRow {
  rank: number;
  ticker: string;
  mentions: number;
  upvotes: number;
  rank_24h_ago: number;
  mentions_24h_ago: number;
  name?: string;
}

interface MergedRow {
  ticker: string;
  name?: string;
  mentions: number;
  mentions24h: number;
  upvotes: number;
  bestRank: number;
  bestRankPrev: number;
  sources: SubKey[];
  bySub: Partial<Record<SubKey, number>>; // mention count by sub
}

// In-memory cache
let cache: { result: RedditTrendingResult; key: string } | null = null;

async function fetchSub(sub: SubKey): Promise<ApewisdomRow[]> {
  const rows: ApewisdomRow[] = [];
  // First 2 pages (~100 tickers) is plenty for trending discovery.
  for (let p = 1; p <= 2; p++) {
    try {
      const r = await fetchWithRetry(`${APEWISDOM_BASE}/${sub}/page/${p}`, {
        headers: { Accept: "application/json" },
      });
      if (!r.ok) return rows;
      const j = (await r.json()) as { results?: ApewisdomRow[]; pages?: number };
      if (!j.results || j.results.length === 0) return rows;
      rows.push(...j.results);
      if (j.pages && p >= j.pages) return rows;
    } catch {
      return rows;
    }
  }
  return rows;
}

function mergeRows(perSub: Array<{ sub: SubKey; rows: ApewisdomRow[] }>): MergedRow[] {
  const byTicker = new Map<string, MergedRow>();
  for (const { sub, rows } of perSub) {
    for (const r of rows) {
      const t = r.ticker.toUpperCase();
      const existing = byTicker.get(t);
      if (!existing) {
        byTicker.set(t, {
          ticker: t,
          name: r.name,
          mentions: r.mentions,
          mentions24h: r.mentions_24h_ago,
          upvotes: r.upvotes,
          bestRank: r.rank,
          bestRankPrev: r.rank_24h_ago,
          sources: [sub],
          bySub: { [sub]: r.mentions },
        });
      } else {
        existing.mentions += r.mentions;
        existing.mentions24h += r.mentions_24h_ago;
        existing.upvotes += r.upvotes;
        if (r.rank < existing.bestRank) existing.bestRank = r.rank;
        if (r.rank_24h_ago < existing.bestRankPrev) existing.bestRankPrev = r.rank_24h_ago;
        if (!existing.sources.includes(sub)) existing.sources.push(sub);
        existing.bySub[sub] = (existing.bySub[sub] ?? 0) + r.mentions;
        if (!existing.name && r.name) existing.name = r.name;
      }
    }
  }
  return Array.from(byTicker.values());
}

function trendOf(m: MergedRow): "Rising" | "Flat" | "Falling" {
  const rankDelta = m.bestRankPrev - m.bestRank;
  const mentionDelta = m.mentions - Math.max(1, m.mentions24h);
  const pct = mentionDelta / Math.max(1, m.mentions24h);
  if (rankDelta >= 4 || pct > 0.5) return "Rising";
  if (rankDelta <= -4 || pct < -0.3) return "Falling";
  return "Flat";
}

function topSourceFor(m: MergedRow): SubKey {
  let best: SubKey = m.sources[0];
  let bestCount = 0;
  for (const s of m.sources) {
    const c = m.bySub[s] ?? 0;
    if (c > bestCount) { bestCount = c; best = s; }
  }
  return best;
}

// ── heuristic fallback ─────────────────────────────────────────────────────

function heuristicEntry(m: MergedRow): RedditTrendingEntry {
  const trend = trendOf(m);
  const upPerMention = m.upvotes / Math.max(1, m.mentions);
  const isOptionsSub = m.sources.includes("options") || m.sources.includes("wallstreetbets");
  const mentionsDelta = m.mentions - m.mentions24h;
  const mentionsDeltaPct = mentionsDelta / Math.max(1, m.mentions24h);

  let sentiment: TrendingSentiment;
  let bullishRatio: number;
  if (m.mentions < 5) { sentiment = "Neutral"; bullishRatio = 0.5; }
  else if (upPerMention > 12 && trend === "Rising") { sentiment = "Bullish"; bullishRatio = 0.72; }
  else if (upPerMention < 3) { sentiment = "Hype"; bullishRatio = 0.5; }
  else if (trend === "Falling") { sentiment = "Bearish"; bullishRatio = 0.35; }
  else if (upPerMention > 6) { sentiment = "Bullish"; bullishRatio = 0.6; }
  else { sentiment = "Mixed"; bullishRatio = 0.5; }

  let category: TrendingCategory = "Trending";
  if (sentiment === "Bullish" && trend === "Rising") category = "Bullish Momentum";
  else if (sentiment === "Bearish") category = "Bearish Momentum";
  else if (sentiment === "Hype" && mentionsDeltaPct > 1) category = "Too Much Hype";
  else if (isOptionsSub && mentionsDeltaPct > 0.5) category = "Options Hype";
  else if (upPerMention < 4 && m.mentions > 30) category = "Lottery Watch";

  const interp =
    category === "Bullish Momentum" ? "Retail interest rising in alignment with momentum."
    : category === "Bearish Momentum" ? "Bearish chatter accelerating — caution if holding."
    : category === "Options Hype" ? "Options discussion spiking — IV may already be inflated."
    : category === "Lottery Watch" ? "High mention volume but thin engagement — speculative only."
    : category === "Too Much Hype" ? "Hype outpacing substance — wait for confirmation."
    : category === "Contrarian Watch" ? "Negative discussion rising — possible contrarian setup."
    : "Mentions detected — monitoring for trend confirmation.";

  const riskNote =
    category === "Too Much Hype" || category === "Lottery Watch"
      ? "High hype risk — treat as speculative only"
      : category === "Options Hype" ? "Implied vol likely elevated"
      : null;

  return {
    ticker: m.ticker,
    mentions: m.mentions,
    mentions24hAgo: m.mentions24h,
    mentionsDelta,
    mentionsDeltaPct,
    upvotes: m.upvotes,
    bestRank: m.bestRank,
    rankDelta: m.bestRankPrev - m.bestRank,
    trend,
    sources: m.sources,
    topSource: topSourceFor(m),
    sentiment,
    bullishRatio,
    category,
    interpretation: interp,
    themes: [],
    optionsFocus: isOptionsSub,
    riskNote,
    classifiedBy: "heuristic",
  };
}

// ── AI classifier ──────────────────────────────────────────────────────────

interface AiClassification {
  ticker: string;
  sentiment: TrendingSentiment;
  bullishRatio: number;
  category: TrendingCategory;
  interpretation: string;
  themes: string[];
  optionsFocus: boolean;
  riskNote: string | null;
}

async function classifyWithAI(merged: MergedRow[]): Promise<Map<string, AiClassification>> {
  const out = new Map<string, AiClassification>();
  const key = process.env.LOVABLE_API_KEY;
  if (!key || merged.length === 0) return out;

  const summary = merged
    .map(m => {
      const trend = trendOf(m);
      const subs = m.sources.join(",");
      return `${m.ticker} | mentions=${m.mentions} (was ${m.mentions24h}) upvotes=${m.upvotes} rank=${m.bestRank}(was ${m.bestRankPrev}) trend=${trend} subs=[${subs}]`;
    })
    .join("\n");

  const body = {
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are an analyst classifying retail trader chatter on Reddit. " +
          "For each ticker, output: sentiment, bullish/bearish ratio (0..1 where 1=fully bullish), " +
          "a category, a 1-sentence interpretation, narrative themes (max 3 short keywords), " +
          "whether discussion is options-focused, and an optional risk note. " +
          "Categories: Trending | Bullish Momentum | Bearish Momentum | Options Hype | Lottery Watch | Contrarian Watch | Too Much Hype. " +
          "Be calibrated — most tickers are 'Trending' or 'Mixed' sentiment; reserve strong labels for clear signals.",
      },
      { role: "user", content: `Classify these Reddit signals:\n${summary}` },
    ],
    tools: [{
      type: "function",
      function: {
        name: "report_signals",
        description: "Return one classification per ticker.",
        parameters: {
          type: "object",
          properties: {
            signals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  ticker: { type: "string" },
                  sentiment: { type: "string", enum: ["Bullish", "Bearish", "Mixed", "Hype", "Neutral"] },
                  bullishRatio: { type: "number" },
                  category: { type: "string", enum: ["Trending", "Bullish Momentum", "Bearish Momentum", "Options Hype", "Lottery Watch", "Contrarian Watch", "Too Much Hype"] },
                  interpretation: { type: "string" },
                  themes: { type: "array", items: { type: "string" } },
                  optionsFocus: { type: "boolean" },
                  riskNote: { type: ["string", "null"] },
                },
                required: ["ticker", "sentiment", "bullishRatio", "category", "interpretation", "themes", "optionsFocus", "riskNote"],
                additionalProperties: false,
              },
            },
          },
          required: ["signals"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "report_signals" } },
  };

  try {
    const r = await fetchWithRetry(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.warn("[reddit-trending] AI HTTP", r.status);
      return out;
    }
    const j = (await r.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return out;
    const parsed = JSON.parse(args) as { signals?: AiClassification[] };
    for (const s of parsed.signals ?? []) {
      out.set(s.ticker.toUpperCase(), s);
    }
  } catch (e) {
    console.warn("[reddit-trending] AI failed", e);
  }
  return out;
}

// ── public API ──────────────────────────────────────────────────────────────

export async function getRedditTrending(limit: number = 60): Promise<RedditTrendingResult> {
  const cacheKey = `limit:${limit}`;
  if (cache && cache.key === cacheKey && Date.now() - cache.result.fetchedAt < CACHE_TTL_MS) {
    return cache.result;
  }

  const results = await Promise.all(
    SUBREDDITS.map(async (sub) => ({ sub, rows: await fetchSub(sub) })),
  );

  const sourcesUsed = results.filter(r => r.rows.length > 0).map(r => r.sub);
  const sourcesFailed = results.filter(r => r.rows.length === 0).map(r => r.sub);

  if (sourcesUsed.length === 0) {
    const empty: RedditTrendingResult = {
      entries: [],
      fetchedAt: Date.now(),
      sourcesUsed: [],
      sourcesFailed,
      aiAvailable: false,
      error: "Reddit signal provider unavailable",
    };
    cache = { result: empty, key: cacheKey };
    return empty;
  }

  const merged = mergeRows(results).sort((a, b) => b.mentions - a.mentions).slice(0, limit);
  const aiMap = await classifyWithAI(merged);
  const aiAvailable = aiMap.size > 0;

  const entries = merged.map((m): RedditTrendingEntry => {
    const base = heuristicEntry(m);
    const ai = aiMap.get(m.ticker);
    if (!ai) return base;
    return {
      ...base,
      sentiment: ai.sentiment,
      bullishRatio: Math.max(0, Math.min(1, ai.bullishRatio)),
      category: ai.category,
      interpretation: ai.interpretation,
      themes: (ai.themes ?? []).slice(0, 3),
      optionsFocus: ai.optionsFocus,
      riskNote: ai.riskNote,
      classifiedBy: "ai",
    };
  });

  const result: RedditTrendingResult = {
    entries,
    fetchedAt: Date.now(),
    sourcesUsed,
    sourcesFailed,
    aiAvailable,
  };
  cache = { result, key: cacheKey };
  return result;
}
