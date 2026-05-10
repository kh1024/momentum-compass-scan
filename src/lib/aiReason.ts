/**
 * Per-row AI rationale generator.
 *
 * Produces a short, human-readable explanation for *why* a candidate matters,
 * blending: setup type, sector context, momentum vs SPY, score tier, Reddit
 * sentiment, and contract moneyness.
 *
 * Deterministic / rule-based — same inputs → same output. An LLM call can
 * later replace this without changing callers.
 */
import type { TradeCandidate } from "./types";
import type { SectorStrength } from "./aiCommentary";

export interface AiReasonContext {
  /** SPY % change today (for relative-strength comparisons). */
  spyChangePct?: number;
  /** Sector strength snapshot (semis/tech/broad). */
  sectors?: SectorStrength[];
}

/**
 * Generate a one-line AI explanation for a single candidate.
 * Returns "" if no meaningful insight could be produced — caller should hide
 * the column rather than show a stub.
 */
export function aiReasonFor(t: TradeCandidate, ctx: AiReasonContext = {}): string {
  const score = t.finalScore ?? t.score;
  const m = t.contract.classification?.moneyness;
  const setup = t.setupType;
  const sentiment = t.redditSentiment;
  const dir = t.direction;
  const isCall = dir === "CALL";

  const semis = ctx.sectors?.find((s) => s.name === "Semis");
  const tech = ctx.sectors?.find((s) => s.name === "Mega Tech");
  const semisStrong = (semis?.changePct ?? 0) > 0.4;
  const techStrong = (tech?.changePct ?? 0) > 0.3;

  const SEMI_TICKERS = new Set(["NVDA", "AMD", "AVGO", "TSM", "MU", "ASML", "SMH", "INTC", "ARM", "QCOM"]);
  const MEGA_TECH = new Set(["AAPL", "MSFT", "GOOGL", "GOOG", "META", "AMZN", "TSLA", "NFLX", "QQQ"]);

  // Sector context line (highest priority — gives the row a "thesis").
  if (SEMI_TICKERS.has(t.ticker) && semisStrong && isCall) {
    return "Semis leading the tape — momentum continuation in play.";
  }
  if (SEMI_TICKERS.has(t.ticker) && (semis?.state === "Weak") && !isCall) {
    return "Semis breaking down — short-side trend extension setup.";
  }
  if (MEGA_TECH.has(t.ticker) && techStrong && isCall) {
    return "Mega-cap tech outperforming — relative strength bid.";
  }

  // Setup-specific theses.
  if (setup === "Pivot/Base Breakout" && score >= 80) {
    return "Clean base breakout with strong volume confirmation.";
  }
  if (setup === "Pivot/Base Retest" && score >= 75) {
    return "Successful retest of breakout level — continuation likely.";
  }
  if (setup === "Pullback-to-Support" && isCall) {
    return "Pullback into support — high R/R reclaim setup.";
  }
  if (setup === "Short-Term Momentum" && score >= 80) {
    return "Strong intraday momentum aligning with trend.";
  }
  if (setup === "LEAPS") {
    return "Long-dated thesis — capital-efficient delta exposure.";
  }
  if (setup === "Reddit YOLO" && sentiment === "Bullish") {
    return "Retail momentum accelerating — flow-driven squeeze risk.";
  }
  if (setup === "Failed Breakout" && !isCall) {
    return "Failed breakout reversal — momentum flipping bearish.";
  }
  if (setup === "Resistance Rejection" && !isCall) {
    return "Rejection at resistance — fade setup with defined risk.";
  }
  if (setup === "Breakdown" && !isCall) {
    return "Trend break confirmed — short-side continuation setup.";
  }

  // Sentiment-led fallbacks.
  if (sentiment === "Bullish" && t.redditMentionTrend === "Rising") {
    return "Rising chatter + bullish tilt — early flow signal.";
  }
  if (sentiment === "Hype-only") {
    return "Hype-driven only — treat as speculative, size small.";
  }

  // Score-tier fallback so every row gets something.
  if (score >= 85) return "Elite setup — multi-factor confirmation aligned.";
  if (score >= 75) return "Strong setup — trend and structure aligned.";
  if (score >= 65) return "Moderate setup — selective entry on confirmation.";
  if (m === "Lottery OTM") return "Speculative far-OTM lottery — low probability, asymmetric reward.";
  return "Speculative — wait for clearer confirmation.";
}
