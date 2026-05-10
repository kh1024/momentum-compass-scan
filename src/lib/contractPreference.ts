/**
 * User-friendly contract preference modes.
 *
 * Controls how the scanner picks strikes, target deltas, and max premium
 * the user is willing to pay per contract. Default is "Balanced Swing" —
 * ATM to slightly OTM, $500 max cost, ~0.35–0.55 delta.
 *
 * Persisted to localStorage so the choice survives reloads. SSR-safe.
 */

export type PreferenceMode = "Balanced" | "Conservative" | "Aggressive" | "Lottery";

export const DEFAULT_PREFERENCE_MODE: PreferenceMode = "Balanced";
export const DEFAULT_MAX_CONTRACT_COST = 500;

export const PREFERENCE_LABEL: Record<PreferenceMode, string> = {
  Balanced: "Balanced Swing",
  Conservative: "Conservative",
  Aggressive: "Aggressive",
  Lottery: "Lottery",
};

export const PREFERENCE_DESCRIPTION: Record<PreferenceMode, string> = {
  Balanced: "ATM to slightly OTM · Δ 0.35–0.55 · realistic upside",
  Conservative: "ATM to slightly ITM · Δ 0.55–0.75 · higher probability",
  Aggressive: "Moderate OTM · Δ 0.20–0.40 · cheaper, higher risk",
  Lottery: "Far OTM · Δ 0.05–0.20 · speculative only",
};

export interface PreferenceState {
  mode: PreferenceMode;
  /** Per-contract max premium in $ (e.g. 500 = $500). */
  maxContractCost: number;
}

const STORAGE_KEY = "scanner.contractPreference.v1";

export const DEFAULT_PREFERENCE_STATE: PreferenceState = {
  mode: DEFAULT_PREFERENCE_MODE,
  maxContractCost: DEFAULT_MAX_CONTRACT_COST,
};

function safeWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export function readPreferenceState(): PreferenceState {
  const w = safeWindow();
  if (!w) return { ...DEFAULT_PREFERENCE_STATE };
  try {
    const raw = w.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCE_STATE };
    const parsed = JSON.parse(raw) as Partial<PreferenceState>;
    const mode =
      parsed.mode === "Conservative" ||
      parsed.mode === "Aggressive" ||
      parsed.mode === "Lottery"
        ? parsed.mode
        : "Balanced";
    const cost =
      typeof parsed.maxContractCost === "number" && parsed.maxContractCost >= 50
        ? parsed.maxContractCost
        : DEFAULT_MAX_CONTRACT_COST;
    return { mode, maxContractCost: cost };
  } catch {
    return { ...DEFAULT_PREFERENCE_STATE };
  }
}

export function writePreferenceState(next: PreferenceState): void {
  const w = safeWindow();
  if (!w) return;
  try {
    w.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    w.dispatchEvent(new CustomEvent("scanner:contractPreference"));
  } catch {
    /* ignore */
  }
}

export function subscribePreferenceState(cb: () => void): () => void {
  const w = safeWindow();
  if (!w) return () => {};
  const handler = () => cb();
  w.addEventListener("scanner:contractPreference", handler);
  w.addEventListener("storage", handler);
  return () => {
    w.removeEventListener("scanner:contractPreference", handler);
    w.removeEventListener("storage", handler);
  };
}

// ---------- Mode → trading rules ----------

export interface DeltaBand {
  min: number;
  max: number;
  ideal: number;
}

/** Mode-aware target |delta| band. Overrides entry-mode default when supplied. */
export function deltaBandForMode(mode: PreferenceMode): DeltaBand {
  switch (mode) {
    case "Conservative":
      return { min: 0.55, max: 0.75, ideal: 0.6 };
    case "Aggressive":
      return { min: 0.2, max: 0.4, ideal: 0.32 };
    case "Lottery":
      return { min: 0.05, max: 0.2, ideal: 0.15 };
    case "Balanced":
    default:
      return { min: 0.35, max: 0.55, ideal: 0.45 };
  }
}

import type { Moneyness } from "./contractClassification";

/** Mode-aware allowed moneyness buckets. */
export function allowedMoneynessForMode(mode: PreferenceMode): Moneyness[] {
  switch (mode) {
    case "Conservative":
      // ATM to slightly ITM, allow ITM. Avoid Deep ITM.
      return ["ATM", "Slightly ITM", "ITM"];
    case "Aggressive":
      // Slightly OTM to OTM. No ITM, no Far OTM lottery.
      return ["ATM", "Slightly OTM", "OTM"];
    case "Lottery":
      // Far OTM only — explicitly speculative.
      return ["OTM", "Far OTM", "Lottery OTM"];
    case "Balanced":
    default:
      // ATM ± 5% — the realistic-swing sweet spot.
      return ["Slightly ITM", "ATM", "Slightly OTM"];
  }
}

/**
 * Realistic-move ceiling for the break-even, given DTE.
 *
 * If the contract requires more than this % move to break even within its
 * lifetime, we treat it as unrealistic and downgrade. Lottery mode allows
 * larger required moves by design.
 */
export function breakevenCeilingPct(mode: PreferenceMode, dte: number): number {
  if (mode === "Lottery") return 0.25; // 25% — speculative
  // Roughly: ~1% per day of DTE, capped.
  const days = Math.max(dte, 1);
  const dynamic = Math.min(0.04 + days * 0.005, 0.12); // 4%–12%
  if (mode === "Conservative") return Math.min(dynamic, 0.07); // tighter
  if (mode === "Aggressive") return Math.min(dynamic + 0.02, 0.14);
  return dynamic;
}
