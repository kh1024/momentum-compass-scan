/**
 * AI Market Intelligence header — derives a compact "state of the tape"
 * snapshot from index proxies + an optional VIX quote and a list of
 * scanned candidates. Used at the top of the Scanner and Dashboard pages.
 */
import type { TradeCandidate } from "./types";
import type { CommentaryQuote, SectorStrength } from "./aiCommentary";
import { sectorStrength } from "./aiCommentary";

export interface MarketIntel {
  /** "Risk-on" / "Mixed" / "Risk-off" — high-level regime read. */
  regime: "Risk-on" | "Mixed" | "Risk-off";
  /** Strongest of the tracked sector proxies (Semis / Mega Tech / Broad). */
  strongestSector: SectorStrength | null;
  /** Weakest of the tracked sector proxies. */
  weakestSector: SectorStrength | null;
  /** Breadth read: % of *visible* candidates that are calls. */
  breadthPct: number;
  /** Volatility regime — derived from VIX or fallback to "Normal". */
  volatilityRegime: "Compressed" | "Normal" | "Elevated" | "Stressed";
  /** Continuation outlook — short narrative driven by regime + breadth. */
  continuationOutlook: string;
  /** Risk environment — short narrative for sizing guidance. */
  riskEnvironment: string;
  /** All sector rows for rendering as chips. */
  sectors: SectorStrength[];
}

export interface MarketIntelInput {
  spy?: CommentaryQuote;
  qqq?: CommentaryQuote;
  smh?: CommentaryQuote;
  vix?: { changePct?: number; price?: number };
  candidates?: TradeCandidate[];
}

function classifyVix(price?: number): MarketIntel["volatilityRegime"] {
  if (!price || !isFinite(price)) return "Normal";
  if (price < 13) return "Compressed";
  if (price < 20) return "Normal";
  if (price < 28) return "Elevated";
  return "Stressed";
}

export function deriveMarketIntel(input: MarketIntelInput): MarketIntel {
  const sectors = sectorStrength(input);
  const sorted = [...sectors].sort((a, b) => b.changePct - a.changePct);
  const strongest = sorted[0] ?? null;
  const weakest = sorted[sorted.length - 1] ?? null;

  const spy = input.spy?.changePct ?? 0;
  const qqq = input.qqq?.changePct ?? 0;
  const smh = input.smh?.changePct ?? 0;
  const avg = (spy + qqq + smh) / 3;
  const regime: MarketIntel["regime"] =
    avg > 0.25 ? "Risk-on" : avg < -0.25 ? "Risk-off" : "Mixed";

  const cands = input.candidates ?? [];
  const calls = cands.filter((c) => c.direction === "CALL").length;
  const breadthPct = cands.length > 0 ? Math.round((calls / cands.length) * 100) : 50;

  const vol = classifyVix(input.vix?.price);

  let continuationOutlook = "Selective — waiting for cleaner momentum.";
  if (regime === "Risk-on" && breadthPct >= 65 && vol !== "Stressed") {
    continuationOutlook = "Trend continuation favored — call setups extend.";
  } else if (regime === "Risk-off" && breadthPct <= 40) {
    continuationOutlook = "Downside continuation — put setups gaining edge.";
  } else if (vol === "Compressed") {
    continuationOutlook = "Volatility compressing — breakouts have higher payoff.";
  } else if (vol === "Stressed") {
    continuationOutlook = "Stressed tape — reduce size, prefer hedged structures.";
  }

  let riskEnvironment = "Normal — standard sizing applies.";
  if (vol === "Compressed" && regime !== "Risk-off") riskEnvironment = "Benign — full risk allocation acceptable.";
  if (vol === "Elevated") riskEnvironment = "Elevated — trim size by ~25%.";
  if (vol === "Stressed") riskEnvironment = "Stressed — defensive sizing only.";
  if (regime === "Risk-off" && vol !== "Compressed") riskEnvironment = "Defensive — favor puts, smaller size.";

  return {
    regime,
    strongestSector: strongest,
    weakestSector: weakest,
    breadthPct,
    volatilityRegime: vol,
    continuationOutlook,
    riskEnvironment,
    sectors,
  };
}
