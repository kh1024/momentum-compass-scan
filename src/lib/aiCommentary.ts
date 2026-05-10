/**
 * Rule-based "AI commentary" — short, contextual phrases derived from
 * regime + market quotes. Designed to feel like a live AI analyst.
 * Hybrid plan: this is the deterministic fallback; an LLM call can replace
 * the output of `marketCommentary` later without changing callers.
 */

export interface CommentaryQuote {
  symbol: string;
  changePct: number;
}

export interface CommentaryInput {
  spy?: CommentaryQuote;
  qqq?: CommentaryQuote;
  smh?: CommentaryQuote;
  bias?: string;
}

/** Pick a one-line market commentary appropriate to the data. */
export function marketCommentary(i: CommentaryInput): string {
  const spy = i.spy?.changePct ?? 0;
  const qqq = i.qqq?.changePct ?? 0;
  const smh = i.smh?.changePct ?? 0;
  const avg = (spy + qqq + smh) / 3;

  const lines: string[] = [];

  if (smh > spy + 0.2 && smh > 0.3) lines.push("Semis leading the tape — risk appetite expanding.");
  else if (smh < spy - 0.3 && smh < 0) lines.push("Semis lagging — defensive rotation underway.");

  if (qqq > spy + 0.15 && qqq > 0) lines.push("Tech outperforming broad market today.");
  else if (qqq < spy - 0.15 && qqq < 0) lines.push("Mega-cap tech weakness pressuring indices.");

  if (avg > 0.5) lines.push("Broad strength across indices — supportive for call setups.");
  else if (avg < -0.5) lines.push("Indices under pressure — favor puts, reduce size on calls.");
  else if (Math.abs(avg) < 0.15) lines.push("Tape is quiet — selectivity matters; lean on best setups.");

  if (i.bias === "Risk-on" && avg > 0) lines.push("Risk-on regime confirmed by index action.");
  if (i.bias === "Risk-off" && avg < 0) lines.push("Risk-off regime — capital flowing to safety.");

  if (lines.length === 0) lines.push("Market mixed — AI is watching for momentum confirmation.");
  return lines[0];
}

/** Rotating "AI insights" — short headlines for the sidebar/live feed. */
export function aiInsights(i: CommentaryInput): string[] {
  const spy = i.spy?.changePct ?? 0;
  const qqq = i.qqq?.changePct ?? 0;
  const smh = i.smh?.changePct ?? 0;
  const out: string[] = [];

  // If no provider returned a non-zero change, we have no meaningful tape —
  // surface a truthful "awaiting data" line rather than fake commentary.
  const hasMove = Math.abs(spy) + Math.abs(qqq) + Math.abs(smh) > 0.0001;
  if (!hasMove) {
    return [
      "Market quiet — waiting for live tape to move.",
      "No directional bias yet today.",
      "Scanner armed — will surface setups once tape activates.",
    ];
  }

  if (smh > 0.5) out.push("Unusual call flow building in semis.");
  if (qqq > 0.4) out.push("Mega-cap tech showing relative strength.");
  if (spy > 0.3 && qqq > 0.3 && smh > 0.3) out.push("All three majors green — momentum aligned.");
  if (spy < -0.4) out.push("SPY losing intraday VWAP — risk reducing.");
  if (smh < -0.5) out.push("Semis breaking down — caution on AI names.");
  if (qqq - spy > 0.3) out.push("Growth > value rotation accelerating.");
  if (spy - qqq > 0.3) out.push("Defensives bid — value outperforming growth.");

  if (out.length === 0) {
    out.push("Mixed tape — AI watching for momentum confirmation.");
  }

  // Context-aware background lines that only run when there IS real movement.
  out.push("Scanner active — refreshing high-quality setups.");
  out.push("AI evaluating momentum continuation probability.");
  return out;
}

/** Sector strength snapshot derived from index proxies. */
export interface SectorStrength {
  name: string;
  changePct: number;
  state: "Strong" | "Firm" | "Mixed" | "Weak";
}

function classify(pct: number): SectorStrength["state"] {
  if (pct > 0.6) return "Strong";
  if (pct > 0.1) return "Firm";
  if (pct < -0.4) return "Weak";
  return "Mixed";
}

export function sectorStrength(i: CommentaryInput): SectorStrength[] {
  const spy = i.spy?.changePct ?? 0;
  const qqq = i.qqq?.changePct ?? 0;
  const smh = i.smh?.changePct ?? 0;
  return [
    { name: "Semis",     changePct: smh, state: classify(smh) },
    { name: "Mega Tech", changePct: qqq, state: classify(qqq) },
    { name: "Broad Mkt", changePct: spy, state: classify(spy) },
  ];
}

/** Crude 0-100 sentiment score from index breadth. */
export function sentimentScore(i: CommentaryInput): { score: number; label: string } {
  const spy = i.spy?.changePct ?? 0;
  const qqq = i.qqq?.changePct ?? 0;
  const smh = i.smh?.changePct ?? 0;
  const avg = (spy + qqq + smh) / 3;
  // Map roughly -1.5%..+1.5% → 0..100
  const score = Math.max(0, Math.min(100, Math.round(50 + avg * 33)));
  const label =
    score >= 75 ? "Greed"
    : score >= 60 ? "Bullish"
    : score >= 45 ? "Neutral"
    : score >= 30 ? "Bearish"
    : "Fear";
  return { score, label };
}

/** Format a freshness timestamp into "live", "30s ago", "5m ago", etc. */
export function freshness(ts: number | null | undefined, now: number = Date.now()): string {
  if (!ts) return "—";
  const ms = Math.max(0, now - ts);
  if (ms < 15_000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
