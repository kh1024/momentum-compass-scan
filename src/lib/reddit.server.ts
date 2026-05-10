/**
 * Reddit signal pipeline — server-only.
 *
 * Source: Apewisdom (free, no key) aggregates r/wallstreetbets mentions.
 * AI classifier: Lovable AI Gateway (gemini-3-flash-preview) maps raw
 * mention/upvote/rank-trend into our Sentiment + MentionTrend enums.
 *
 * Cache: 30 min in-memory. WSB top list is fetched once per cycle and a
 * single batched AI call classifies every requested ticker.
 */

import { fetchWithRetry } from "./fetchRetry.server";
import type { Sentiment } from "./types";

export type MentionTrend = "Rising" | "Flat" | "Falling";

export interface RedditSignal {
  ticker: string;
  mentions: number;
  upvotes: number;
  rank: number;
  rankPrev: number;
  rankDelta: number; // +ve = climbing
  mentionTrend: MentionTrend;
  sentiment: Sentiment;
  source: "apewisdom+ai" | "apewisdom" | "none";
}

interface ApewisdomRow {
  rank: number;
  ticker: string;
  mentions: number;
  upvotes: number;
  rank_24h_ago: number;
  mentions_24h_ago: number;
}

const APEWISDOM_BASE = "https://apewisdom.io/api/v1.0/filter/wallstreetbets";
const CACHE_TTL_MS = 30 * 60_000;
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

let cache: { rows: ApewisdomRow[]; fetchedAt: number } | null = null;
let signalCache: { byTicker: Map<string, RedditSignal>; fetchedAt: number } = {
  byTicker: new Map(),
  fetchedAt: 0,
};

async function fetchApewisdom(): Promise<ApewisdomRow[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  const rows: ApewisdomRow[] = [];
  // Pull first 3 pages (~150 tickers) — covers the universe we scan.
  for (let p = 1; p <= 3; p++) {
    try {
      const r = await fetchWithRetry(`${APEWISDOM_BASE}/page/${p}`, {
        headers: { Accept: "application/json" },
      });
      if (!r.ok) break;
      const j = (await r.json()) as { results?: ApewisdomRow[]; pages?: number };
      if (!j.results || j.results.length === 0) break;
      rows.push(...j.results);
      if (j.pages && p >= j.pages) break;
    } catch (e) {
      console.warn("[reddit] apewisdom page failed", p, e);
      break;
    }
  }
  cache = { rows, fetchedAt: Date.now() };
  return rows;
}

function trendOf(rank: number, rankPrev: number, mentions: number, mentions24h: number): MentionTrend {
  // Rank climbing = lower number than yesterday (rank 5 → 2 means rising).
  const rankDelta = rankPrev - rank;
  const mentionDelta = mentions - Math.max(1, mentions24h);
  if (rankDelta >= 5 || mentionDelta > mentions24h * 0.5) return "Rising";
  if (rankDelta <= -5 || mentionDelta < -mentions24h * 0.3) return "Falling";
  return "Flat";
}

interface AiClassification {
  ticker: string;
  sentiment: Sentiment;
}

async function classifyWithAI(rows: Array<ApewisdomRow & { trend: MentionTrend }>): Promise<Map<string, Sentiment>> {
  const out = new Map<string, Sentiment>();
  const key = process.env.LOVABLE_API_KEY;
  if (!key || rows.length === 0) return out;

  const summary = rows
    .map(r => `${r.ticker}: ${r.mentions} mentions, ${r.upvotes} upvotes, rank ${r.rank} (was ${r.rank_24h_ago}), trend ${r.trend}`)
    .join("\n");

  const body = {
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You classify retail-trader sentiment from r/wallstreetbets aggregate mention data. " +
          "Use upvote-to-mention ratio + rank momentum + mention volume. " +
          "Bullish = strongly positive, Bearish = strongly negative, Mixed = both sides, " +
          "Hype-only = surge in low-quality buzz with low signal, None = not enough data.",
      },
      { role: "user", content: `Classify each ticker:\n${summary}` },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "report_sentiment",
          description: "Return one classification per ticker.",
          parameters: {
            type: "object",
            properties: {
              classifications: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    ticker: { type: "string" },
                    sentiment: { type: "string", enum: ["Bullish", "Bearish", "Mixed", "Hype-only", "None"] },
                  },
                  required: ["ticker", "sentiment"],
                  additionalProperties: false,
                },
              },
            },
            required: ["classifications"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "report_sentiment" } },
  };

  try {
    const r = await fetchWithRetry(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.warn("[reddit] AI classify HTTP", r.status);
      return out;
    }
    const j = (await r.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return out;
    const parsed = JSON.parse(args) as { classifications?: AiClassification[] };
    for (const c of parsed.classifications ?? []) {
      out.set(c.ticker.toUpperCase(), c.sentiment);
    }
  } catch (e) {
    console.warn("[reddit] AI classify failed", e);
  }
  return out;
}

/** Heuristic fallback when the AI gateway is unavailable. */
function fallbackSentiment(r: ApewisdomRow, trend: MentionTrend): Sentiment {
  const ratio = r.upvotes / Math.max(1, r.mentions);
  if (r.mentions < 5) return "None";
  if (ratio > 15) return trend === "Rising" ? "Bullish" : "Mixed";
  if (ratio < 3) return "Hype-only";
  if (trend === "Rising" && ratio > 8) return "Bullish";
  if (trend === "Falling") return "Bearish";
  return "Mixed";
}

/**
 * Build sentiment for a list of tickers. Caches the full classified universe
 * for 30 min so repeated calls within the cycle never re-hit the AI gateway.
 */
export async function getRedditSignals(symbols: string[]): Promise<Record<string, RedditSignal>> {
  const wanted = Array.from(new Set(symbols.map(s => s.toUpperCase())));
  if (wanted.length === 0) return {};

  // Refresh classified universe if stale.
  if (Date.now() - signalCache.fetchedAt > CACHE_TTL_MS || signalCache.byTicker.size === 0) {
    const rows = await fetchApewisdom();
    const enriched = rows.map(r => ({ ...r, trend: trendOf(r.rank, r.rank_24h_ago, r.mentions, r.mentions_24h_ago) }));
    // Only classify the top 60 — bounds AI cost while still covering popular names.
    const topForAI = enriched.slice(0, 60);
    const aiMap = await classifyWithAI(topForAI);
    const next = new Map<string, RedditSignal>();
    for (const r of enriched) {
      const trend = r.trend;
      const ai = aiMap.get(r.ticker.toUpperCase());
      const sentiment: Sentiment = ai ?? fallbackSentiment(r, trend);
      next.set(r.ticker.toUpperCase(), {
        ticker: r.ticker.toUpperCase(),
        mentions: r.mentions,
        upvotes: r.upvotes,
        rank: r.rank,
        rankPrev: r.rank_24h_ago,
        rankDelta: r.rank_24h_ago - r.rank,
        mentionTrend: trend,
        sentiment,
        source: ai ? "apewisdom+ai" : "apewisdom",
      });
    }
    signalCache = { byTicker: next, fetchedAt: Date.now() };
  }

  const out: Record<string, RedditSignal> = {};
  for (const s of wanted) {
    const hit = signalCache.byTicker.get(s);
    if (hit) out[s] = hit;
  }
  return out;
}
