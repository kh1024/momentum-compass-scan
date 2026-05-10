/**
 * AI-powered grade & scanner-improvement suggestions for the Performance page.
 * Routes through the Lovable AI Gateway (no key exposed to client).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

interface AIResult {
  ok: boolean;
  text: string | null;
  rateLimited: boolean;
  paymentRequired: boolean;
  message: string | null;
}

async function callGateway(system: string, user: string): Promise<AIResult> {
  if (!process.env.LOVABLE_API_KEY) {
    return { ok: false, text: null, rateLimited: false, paymentRequired: false,
      message: "Lovable AI Gateway not configured." };
  }
  try {
    const r = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (r.status === 429) return { ok: false, text: null, rateLimited: true, paymentRequired: false,
      message: "AI is rate-limited. Try again shortly." };
    if (r.status === 402) return { ok: false, text: null, rateLimited: false, paymentRequired: true,
      message: "Lovable AI credits exhausted. Add funds in Settings → Workspace → Usage." };
    if (!r.ok) return { ok: false, text: null, rateLimited: false, paymentRequired: false,
      message: `AI call failed (${r.status}).` };
    const j = await r.json() as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content?.trim() ?? null;
    return { ok: Boolean(text), text, rateLimited: false, paymentRequired: false,
      message: text ? null : "Empty AI response." };
  } catch (e) {
    return { ok: false, text: null, rateLimited: false, paymentRequired: false,
      message: e instanceof Error ? e.message : "AI request failed." };
  }
}

const TradeReviewSystem = `You are a no-nonsense options trading coach reviewing a closed scanner pick.
Be honest, data-driven, and brief. No celebration of winners — focus on what went right and wrong, and what to do next time.
Output exactly five short sections separated by blank lines, each labeled:
GRADE: <A+|A|B|C|D|F>
WHAT WENT RIGHT: 1–2 sentences
WHAT WENT WRONG: 1–2 sentences
SHOULD HAVE BEEN: <Buy Now|Watchlist|Aggressive|Avoid> — 1 sentence why
LESSON: 1 sentence rule for the scanner.
No markdown headers, no bullets, no disclaimers.`;

const TradeReviewInput = z.object({
  ticker: z.string(),
  direction: z.string(),
  setupType: z.string(),
  label: z.string(),
  aiScore: z.number(),
  delta: z.number(),
  dte: z.number(),
  iv: z.number(),
  thetaBurnPct: z.number(),
  spreadPct: z.number(),
  marketRegime: z.string(),
  triggerFired: z.boolean(),
  finalReturnPct: z.number(),
  maxGainPct: z.number(),
  maxDrawdownPct: z.number(),
  hitTarget1: z.boolean(),
  hitStop: z.boolean(),
  invalidated: z.boolean(),
  notes: z.string(),
});

export const reviewTrade = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TradeReviewInput.parse(d))
  .handler(async ({ data }): Promise<AIResult> => {
    const u = [
      `${data.ticker} ${data.direction} · ${data.setupType} · label ${data.label} · score ${data.aiScore}/100`,
      `Greeks: Δ ${data.delta.toFixed(2)} · DTE ${data.dte} · IV ${(data.iv*100).toFixed(0)}% · θ-burn ${(data.thetaBurnPct*100).toFixed(1)}%/d · spread ${(data.spreadPct*100).toFixed(0)}%`,
      `Market: ${data.marketRegime}`,
      `Outcome: trigger ${data.triggerFired ? "fired" : "did not fire"} · final ${(data.finalReturnPct*100).toFixed(1)}% · MFE ${(data.maxGainPct*100).toFixed(1)}% · MAE ${(data.maxDrawdownPct*100).toFixed(1)}%`,
      `Targets: T1 ${data.hitTarget1?"hit":"miss"} · stop ${data.hitStop?"hit":"safe"} · ${data.invalidated?"invalidated":"intact"}`,
      `Notes: ${data.notes}`,
    ].join("\n");
    return callGateway(TradeReviewSystem, u);
  });

const ScannerImprovementSystem = `You are an options scanner engineer. Given aggregate performance stats from recent picks, output a concise list of concrete rule changes the scanner should adopt.
Format: 4–8 lines, each starting with "- " then a single rule (no extra prose).
Examples of good rules:
- Tighten YOLO delta minimum to 0.25 (current YOLO win rate 0%).
- Penalize counter-trend puts in Risk-on regimes (avg return -58.5%).
Numbers MUST come from the supplied stats. No disclaimers.`;

const StatsInput = z.object({
  summary: z.record(z.string(), z.any()),
  bySetup: z.array(z.object({ bucket: z.string(), n: z.number(), winRate: z.number(), avgReturn: z.number() })),
  byDelta: z.array(z.object({ bucket: z.string(), n: z.number(), winRate: z.number(), avgReturn: z.number() })),
  byDte: z.array(z.object({ bucket: z.string(), n: z.number(), winRate: z.number(), avgReturn: z.number() })),
  byTheta: z.array(z.object({ bucket: z.string(), n: z.number(), winRate: z.number(), avgReturn: z.number() })),
  byIV: z.array(z.object({ bucket: z.string(), n: z.number(), winRate: z.number(), avgReturn: z.number() })),
  byRegime: z.array(z.object({ bucket: z.string(), n: z.number(), winRate: z.number(), avgReturn: z.number() })),
});

function fmtBuckets(name: string, rows: { bucket: string; n: number; winRate: number; avgReturn: number }[]): string {
  return `${name}: ` + rows.map(r => `${r.bucket} (n=${r.n}, win ${(r.winRate*100).toFixed(0)}%, avg ${(r.avgReturn*100).toFixed(1)}%)`).join(" · ");
}

export const generateScannerImprovements = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => StatsInput.parse(d))
  .handler(async ({ data }): Promise<AIResult> => {
    const summary = data.summary as Record<string, any>;
    const u = [
      `Summary: tracked ${summary.totalTracked} · win rate ${(summary.winRate*100).toFixed(0)}% · avg return ${(summary.avgReturn*100).toFixed(1)}% · best setup ${summary.bestSetup} · worst setup ${summary.worstSetup} · best regime ${summary.bestMarketRegime}`,
      fmtBuckets("By setup", data.bySetup),
      fmtBuckets("By delta", data.byDelta),
      fmtBuckets("By DTE", data.byDte),
      fmtBuckets("By theta-burn", data.byTheta),
      fmtBuckets("By IV", data.byIV),
      fmtBuckets("By regime", data.byRegime),
      "",
      "Produce scanner rule updates.",
    ].join("\n");
    return callGateway(ScannerImprovementSystem, u);
  });
