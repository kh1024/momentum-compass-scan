import { createServerFn } from "@tanstack/react-start";

export type NewsAiSummary = {
  summary: string;
  bullets: string[];
  error: string | null;
};

type SummaryInput = {
  title: string;
  snippet?: string;
  source?: string;
};

function fallback(input: SummaryInput, error: string): NewsAiSummary {
  return {
    summary: input.snippet?.trim() || input.title,
    bullets: [],
    error,
  };
}

export const summarizeHeadline = createServerFn({ method: "POST" })
  .inputValidator((data: SummaryInput) => {
    if (!data || typeof data.title !== "string" || !data.title.trim()) {
      throw new Error("title is required");
    }
    return {
      title: data.title.slice(0, 500),
      snippet: (data.snippet ?? "").slice(0, 1500),
      source: (data.source ?? "").slice(0, 100),
    };
  })
  .handler(async ({ data }): Promise<NewsAiSummary> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return fallback(data, "LOVABLE_API_KEY missing");

    const userContent = [
      `Source: ${data.source || "news"}`,
      `Headline: ${data.title}`,
      data.snippet ? `Snippet: ${data.snippet}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const res = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content:
                  "You analyze financial news for traders. Be concise, neutral, and concrete. Avoid speculation. Never invent numbers or tickers not present in the input.",
              },
              {
                role: "user",
                content: `Analyze this market headline and return:\n1) A one-sentence neutral summary (max 30 words).\n2) 2-3 key trading catalysts as short bullets (max 12 words each). Each bullet should describe a concrete market-relevant implication (sector impact, macro driver, earnings signal, policy shift, etc.).\n\n${userContent}`,
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "emit_headline_analysis",
                  description: "Return the summary and catalysts.",
                  parameters: {
                    type: "object",
                    properties: {
                      summary: { type: "string" },
                      bullets: {
                        type: "array",
                        items: { type: "string" },
                        minItems: 1,
                        maxItems: 4,
                      },
                    },
                    required: ["summary", "bullets"],
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: {
              type: "function",
              function: { name: "emit_headline_analysis" },
            },
          }),
        },
      );

      if (!res.ok) {
        const status = res.status;
        if (status === 429) return fallback(data, "Rate limited");
        if (status === 402) return fallback(data, "AI credits exhausted");
        return fallback(data, `AI gateway error ${status}`);
      }

      const json = await res.json();
      const call =
        json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!call) return fallback(data, "No analysis returned");
      const parsed = JSON.parse(call) as {
        summary?: string;
        bullets?: string[];
      };
      const bullets = Array.isArray(parsed.bullets)
        ? parsed.bullets
            .map((b) => String(b).trim())
            .filter(Boolean)
            .slice(0, 4)
        : [];
      return {
        summary: (parsed.summary ?? "").trim() || data.title,
        bullets,
        error: null,
      };
    } catch (e) {
      console.error("summarizeHeadline error:", e);
      return fallback(data, e instanceof Error ? e.message : "unknown");
    }
  });
