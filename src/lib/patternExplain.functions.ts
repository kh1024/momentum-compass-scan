import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildCacheKey, readApiCache, writeApiCache } from "./apiCache";
import { fetchCompanyNews } from "./finnhub.server";

const InputSchema = z.object({
  ticker: z.string().min(1).max(10),
  pattern: z.string().min(1).max(64),
  bias: z.enum(["Bullish", "Bearish"]),
  trigger: z.number().optional(),
  target: z.number().optional(),
});

export interface PatternExplain {
  catalyst: string;
  technical: string;
  sentiment: string;
}

export interface PatternExplainResult {
  data: PatternExplain | null;
  error: string | null;
  cachedAt?: number;
}

const TTL_MS = 2 * 60 * 60 * 1000; // 2h — headlines move fast

export const explainPattern = createServerFn({ method: "POST" })
  .inputValidator((d) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<PatternExplainResult> => {
    const key = buildCacheKey([
      "pattern-explain",
      data.ticker,
      data.pattern,
      data.bias,
    ]);
    const cached = readApiCache<PatternExplain>(key);
    if (cached) {
      return { data: cached.value, error: null, cachedAt: cached.cachedAt };
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { data: null, error: "AI gateway is not configured" };
    }

    // Pull recent headlines from Finnhub to ground the catalyst.
    const news = await fetchCompanyNews(data.ticker, 7);
    const topHeadlines = news
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, 6)
      .map((n) => {
        const ageDays = Math.max(0, Math.round((Date.now() / 1000 - n.datetime) / 86400));
        return `- [${ageDays}d ago · ${n.source}] ${n.headline}`;
      })
      .join("\n");

    const sys = `You explain why a stock chart pattern is bullish or bearish. You will be given recent real headlines for the ticker — use them as your PRIMARY source for the "catalyst" field. If the headlines contain a material driver (earnings, partnership, product launch, guidance, M&A, downgrade, lawsuit), cite it concisely. If the headlines are only routine analyst notes or unrelated to the bias, say "No material catalyst — technical setup only". Never invent news. Keep each field under 140 characters, plain English, no hashtags or emojis.`;

    const user = `Ticker: ${data.ticker}
Pattern: ${data.pattern}
Bias: ${data.bias}
${data.trigger ? `Trigger: $${data.trigger}` : ""}
${data.target ? `Target: $${data.target}` : ""}

Recent headlines (last 7 days):
${topHeadlines || "(no recent headlines available)"}

Return three short bullets: catalyst (news/event driver, grounded in the headlines above), technical (what the chart is doing), sentiment (flow / Reddit / options positioning).`;

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "explain",
                description: "Return a structured catalyst explanation.",
                parameters: {
                  type: "object",
                  properties: {
                    catalyst: { type: "string" },
                    technical: { type: "string" },
                    sentiment: { type: "string" },
                  },
                  required: ["catalyst", "technical", "sentiment"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "explain" } },
        }),
      });

      if (res.status === 429) {
        return { data: null, error: "AI rate limit hit, try again in a moment" };
      }
      if (res.status === 402) {
        return { data: null, error: "AI credits exhausted — top up in Settings" };
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("explainPattern gateway error:", res.status, t);
        return { data: null, error: `AI error (${res.status})` };
      }

      const json = await res.json();
      const call = json?.choices?.[0]?.message?.tool_calls?.[0];
      const argsStr = call?.function?.arguments;
      if (!argsStr) {
        return { data: null, error: "AI returned no structured output" };
      }
      const parsed = JSON.parse(argsStr) as PatternExplain;
      const clean: PatternExplain = {
        catalyst: String(parsed.catalyst ?? "").slice(0, 200),
        technical: String(parsed.technical ?? "").slice(0, 200),
        sentiment: String(parsed.sentiment ?? "").slice(0, 200),
      };
      writeApiCache(key, clean, TTL_MS);
      return { data: clean, error: null, cachedAt: Date.now() };
    } catch (e) {
      console.error("explainPattern failed:", e);
      return { data: null, error: e instanceof Error ? e.message : "AI request failed" };
    }
  });
