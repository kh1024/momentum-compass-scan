/**
 * UI Vocabulary — single source of truth for the new AI-scanner label/badge
 * vocabulary. Internal types in disciplineGate / scoring stay unchanged; only
 * the presentation layer maps through these helpers.
 */
import type { Label, TradeCandidate } from "./types";

/** New user-facing labels that replace the old trader-terminal vocabulary. */
export type DisplayLabel =
  | "High Conviction"
  | "Momentum"
  | "Near Entry"
  | "Aggressive"
  | "Lottery"
  | "Watch Closely"
  | "Hidden";

/** Map internal Label → user-facing DisplayLabel. */
export function displayLabelFor(label: Label): DisplayLabel {
  switch (label) {
    case "Buy Now": return "High Conviction";
    case "Watchlist":
    case "Waiting on Trigger": return "Near Entry";
    case "Aggressive": return "Aggressive";
    case "Lotto": return "Lottery";
    case "Near Miss": return "Watch Closely";
    case "Find Better Strike":
    case "Avoid Contract":
    case "Avoid Ticker":
    case "Avoid":
    default: return "Hidden";
  }
}

/** Section keys for the dashboard layout. */
export type SectionKey = "high-conviction" | "momentum" | "near-entry" | "aggressive" | "lottery" | "watch";

export const SECTION_TITLES: Record<SectionKey, string> = {
  "high-conviction": "High Conviction",
  "momentum": "Momentum",
  "near-entry": "Near Entry",
  "aggressive": "Aggressive",
  "lottery": "Lottery",
  "watch": "Watch Closely",
};

/** Tailwind classes (text + accent bar) for each display label. */
export const DISPLAY_LABEL_STYLES: Record<DisplayLabel, { text: string; bar: string; chip: string }> = {
  "High Conviction": {
    text: "text-[var(--color-bull)]",
    bar: "bg-[var(--color-bull)]",
    chip: "bg-[var(--color-bull)]/15 text-[var(--color-bull)] border-[var(--color-bull)]/40",
  },
  "Momentum": {
    text: "text-emerald-400",
    bar: "bg-emerald-400",
    chip: "bg-emerald-400/15 text-emerald-400 border-emerald-400/40",
  },
  "Near Entry": {
    text: "text-sky-400",
    bar: "bg-sky-400",
    chip: "bg-sky-500/15 text-sky-400 border-sky-500/40",
  },
  "Aggressive": {
    text: "text-amber-500",
    bar: "bg-amber-500",
    chip: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  },
  "Lottery": {
    text: "text-purple-400",
    bar: "bg-purple-400",
    chip: "bg-purple-500/15 text-purple-400 border-purple-500/40",
  },
  "Watch Closely": {
    text: "text-fuchsia-400",
    bar: "bg-fuchsia-400",
    chip: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/40",
  },
  "Hidden": {
    text: "text-muted-foreground",
    bar: "bg-muted-foreground",
    chip: "bg-muted/40 text-muted-foreground border-border",
  },
};

/** Lightweight feature badges. Replaces verbose blocker strings. */
export type BadgeKind =
  | "high-iv"
  | "wide-spread"
  | "low-liquidity"
  | "extended-move"
  | "high-risk"
  | "momentum-confirmed"
  | "waiting-pullback"
  | "strong-continuation"
  | "earnings-soon";

export interface Badge {
  kind: BadgeKind;
  label: string;
  tone: "warn" | "danger" | "info" | "good";
}

/** Derive at most ~3 lightweight badges from a candidate. */
export function badgesFor(t: TradeCandidate): Badge[] {
  const c = t.contract;
  const out: Badge[] = [];

  if (c.iv > 0.8) out.push({ kind: "high-iv", label: "High IV", tone: "warn" });
  if (c.spreadPct > 0.15) out.push({ kind: "wide-spread", label: "Wide Spread", tone: "warn" });
  if (c.openInterest < 300 || c.volume < 100) out.push({ kind: "low-liquidity", label: "Low Liquidity", tone: "warn" });
  if (c.breakevenMovePct > 0.08) out.push({ kind: "extended-move", label: "Extended Move", tone: "warn" });
  if (t.label === "Lotto" || t.label === "Aggressive") out.push({ kind: "high-risk", label: "High Risk", tone: "warn" });

  // Trigger-aware soft state — surfaced as friendly badges, not blockers.
  if (t.triggerStatus === "active") out.push({ kind: "momentum-confirmed", label: "Momentum Confirmed", tone: "good" });
  else if (t.triggerStatus === "waiting-retest") out.push({ kind: "waiting-pullback", label: "Waiting Pullback", tone: "info" });

  if ((t.finalScore ?? t.score) >= 88 && t.triggerStatus === "active") {
    out.push({ kind: "strong-continuation", label: "Strong Continuation", tone: "good" });
  }

  // Dedupe and cap.
  const seen = new Set<BadgeKind>();
  return out.filter((b) => (seen.has(b.kind) ? false : (seen.add(b.kind), true))).slice(0, 4);
}

/** Hold-timeframe estimate for the card. */
export function holdTimeframe(t: TradeCandidate): string {
  const dte = t.contract.dte;
  if (t.setupType === "LEAPS") return "Long-term";
  if (dte <= 7) return "Day–Week";
  if (dte <= 21) return "Swing";
  if (dte <= 45) return "Multi-week";
  return "Position";
}

/** One-line AI-style thesis. Falls back to existing `trend` / `sectorConfirmation`. */
export function aiThesis(t: TradeCandidate): string {
  if (t.thesis) return t.thesis;
  const why = t.sectorConfirmation || t.trend;
  return why || `${t.setupType} setup on ${t.ticker}.`;
}

/** Risk level from final score + label. */
export function riskLevel(t: TradeCandidate): "Low" | "Moderate" | "High" | "Speculative" {
  if (t.label === "Lotto") return "Speculative";
  if (t.label === "Aggressive") return "High";
  const s = t.finalScore ?? t.score;
  if (s >= 85) return "Low";
  if (s >= 70) return "Moderate";
  return "High";
}

/** Section assignment for a candidate. Returns null if it should be hidden. */
export function sectionFor(t: TradeCandidate): SectionKey | null {
  const d = displayLabelFor(t.label);
  switch (d) {
    case "High Conviction": return "high-conviction";
    case "Near Entry": return "near-entry";
    case "Aggressive": return "aggressive";
    case "Lottery": return "lottery";
    case "Watch Closely": return "watch";
    case "Momentum": return "momentum";
    case "Hidden": return null;
  }
}
