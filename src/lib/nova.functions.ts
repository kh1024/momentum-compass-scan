/**
 * Nova — AI trade explanations via the Lovable AI Gateway.
 * No external key required: LOVABLE_API_KEY is auto-provisioned.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

export interface NovaResult {
  ok: boolean;
  explanation: string | null;
  rateLimited: boolean;
  paymentRequired: boolean;
  message: string | null;
  model: string;
  latencyMs: number;
}

export function novaConfigured(): boolean {
  return Boolean(process.env.LOVABLE_API_KEY);
}

export async function novaProbe(): Promise<{
  ok: boolean;
  configured: boolean;
  latencyMs: number | null;
  error?: string;
}> {
  if (!novaConfigured()) {
    return { ok: false, configured: false, latencyMs: null, error: "LOVABLE_API_KEY not set" };
  }
  const started = Date.now();
  try {
    const r = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
    });
    const latencyMs = Date.now() - started;
    if (r.ok) return { ok: true, configured: true, latencyMs };
    if (r.status === 429) return { ok: false, configured: true, latencyMs, error: "Rate limit" };
    if (r.status === 402) return { ok: false, configured: true, latencyMs, error: "Add credits" };
    return { ok: false, configured: true, latencyMs, error: `HTTP ${r.status}` };
  } catch (e) {
    return {
      ok: false, configured: true, latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const SYSTEM_PROMPT = `You are Nova, a senior options trading coach for the Momentum Options Scanner.
Explain the trade setup like a no-nonsense desk strategist talking to a self-directed retail trader.
Cover, in this order, in 5-8 short sentences total:
1. The thesis in plain English (what move and why now).
2. Why this contract (delta, DTE, theta burn, IV) fits the thesis.
3. The single most important risk (level break, IV crush, earnings, etc.).
4. A one-line "do this / skip if" verdict.
Never invent earnings, news, or numbers not provided. Never give personalized financial advice — frame ideas as analysis.
No disclaimers about being an AI. No bullet lists, no markdown headers — just tight prose.`;

const Input = z.object({
  ticker: z.string().min(1).max(10),
  direction: z.enum(["CALL", "PUT"]),
  setupType: z.string().min(1).max(60),
  score: z.number().min(0).max(100),
  label: z.string().min(1).max(40),
  price: z.number().positive(),
  trend: z.string().max(280).optional(),
  contract: z.object({
    strike: z.number(),
    expiration: z.string(),
    dte: z.number(),
    ask: z.number(),
    iv: z.number(),
    delta: z.number(),
    thetaBurnPct: z.number(),
    spreadPct: z.number(),
    breakeven: z.number(),
    breakevenMovePct: z.number(),
    openInterest: z.number(),
    volume: z.number(),
  }),
  entryTrigger: z.string().max(280).optional(),
  invalidation: z.string().max(280).optional(),
  expectedMovePct: z.number().optional(),
});

function buildUserPrompt(d: z.infer<typeof Input>): string {
  const c = d.contract;
  return [
    `Ticker: ${d.ticker} (${d.direction}) · setup: ${d.setupType} · score ${d.score}/100 · label ${d.label}`,
    `Underlying: $${d.price.toFixed(2)}${d.trend ? ` · trend: ${d.trend}` : ""}`,
    `Contract: ${c.expiration} $${c.strike} ${d.direction}, DTE ${c.dte}, ask $${c.ask.toFixed(2)}`,
    `Greeks: Δ ${c.delta.toFixed(2)}, IV ${(c.iv * 100).toFixed(0)}%, θ-burn ${(c.thetaBurnPct * 100).toFixed(1)}%/d, spread ${(c.spreadPct * 100).toFixed(0)}%`,
    `Liquidity: OI ${c.openInterest.toLocaleString()}, vol ${c.volume.toLocaleString()}`,
    `Breakeven $${c.breakeven.toFixed(2)} (${(c.breakevenMovePct * 100).toFixed(1)}% move)${
      d.expectedMovePct ? ` · 1σ expected move ${(d.expectedMovePct * 100).toFixed(1)}%` : ""
    }`,
    d.entryTrigger ? `Entry trigger: ${d.entryTrigger}` : "",
    d.invalidation ? `Invalidation: ${d.invalidation}` : "",
    "",
    "Explain this trade.",
  ].filter(Boolean).join("\n");
}

export const explainTrade = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<NovaResult> => {
    if (!novaConfigured()) {
      return {
        ok: false, explanation: null,
        rateLimited: false, paymentRequired: false,
        message: "Nova is unavailable — Lovable AI Gateway is not configured.",
        model: DEFAULT_MODEL, latencyMs: 0,
      };
    }

    const started = Date.now();
    try {
      const r = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(data) },
          ],
        }),
      });
      const latencyMs = Date.now() - started;

      if (r.status === 429) {
        return {
          ok: false, explanation: null,
          rateLimited: true, paymentRequired: false,
          message: "Nova is busy — rate limit hit. Try again in a moment.",
          model: DEFAULT_MODEL, latencyMs,
        };
      }
      if (r.status === 402) {
        return {
          ok: false, explanation: null,
          rateLimited: false, paymentRequired: true,
          message: "Nova is out of credits. Add funds in Settings → Workspace → Usage.",
          model: DEFAULT_MODEL, latencyMs,
        };
      }
      if (!r.ok) {
        const body = (await r.text()).slice(0, 200);
        return {
          ok: false, explanation: null,
          rateLimited: false, paymentRequired: false,
          message: `Nova call failed (${r.status}): ${body}`,
          model: DEFAULT_MODEL, latencyMs,
        };
      }

      const j = (await r.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const explanation = j.choices?.[0]?.message?.content?.trim() ?? null;
      return {
        ok: Boolean(explanation), explanation,
        rateLimited: false, paymentRequired: false,
        message: explanation ? null : "Nova returned an empty response.",
        model: DEFAULT_MODEL, latencyMs,
      };
    } catch (e) {
      return {
        ok: false, explanation: null,
        rateLimited: false, paymentRequired: false,
        message: e instanceof Error ? e.message : "Nova request failed.",
        model: DEFAULT_MODEL, latencyMs: Date.now() - started,
      };
    }
  });

export const getNovaStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ configured: boolean; ok: boolean; latencyMs: number | null; model: string; error?: string }> => {
    const probe = await novaProbe();
    return { ...probe, model: DEFAULT_MODEL };
  },
);
