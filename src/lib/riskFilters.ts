/**
 * Risk Filter Engine — app-wide thresholds applied to every TradeCandidate
 * before it renders. Persisted to localStorage and broadcast via a custom
 * event so all consumers stay in sync.
 */
import type { TradeCandidate } from "./types";

export interface RiskFilters {
  /** Max cost per contract ($ per single contract). */
  maxContractCost: number;
  /** Minimum absolute delta for short-term contracts. */
  minDelta: number;
  /** Max implied volatility (0–1). */
  maxIV: number;
  /** Min open interest. */
  minOI: number;
  /** Min daily volume. */
  minVolume: number;
  /** Inclusive DTE range. */
  minDTE: number;
  maxDTE: number;
  /** Max theta burn % per day (0–1). */
  maxThetaBurnPct: number;
  /** Max bid/ask spread % (0–1). */
  maxSpreadPct: number;
  /** Layer toggles. */
  allowReddit: boolean;
  allowLeaps: boolean;
  allowPuts: boolean;
  allowYolo: boolean;
}

export type RiskPresetKey = "Conservative" | "Balanced" | "Aggressive" | "Lotto";

export const RISK_PRESETS: Record<RiskPresetKey, RiskFilters> = {
  Conservative: {
    maxContractCost: 500,
    minDelta: 0.5,
    maxIV: 0.45,
    minOI: 1000,
    minVolume: 250,
    minDTE: 21,
    maxDTE: 60,
    maxThetaBurnPct: 0.05,
    maxSpreadPct: 0.1,
    allowReddit: false,
    allowLeaps: true,
    allowPuts: true,
    allowYolo: false,
  },
  Balanced: {
    maxContractCost: 1000,
    minDelta: 0.35,
    maxIV: 0.6,
    minOI: 500,
    minVolume: 100,
    minDTE: 7,
    maxDTE: 30,
    maxThetaBurnPct: 0.08,
    maxSpreadPct: 0.15,
    allowReddit: true,
    allowLeaps: true,
    allowPuts: true,
    allowYolo: true,
  },
  Aggressive: {
    maxContractCost: 1500,
    minDelta: 0.25,
    maxIV: 0.9,
    minOI: 200,
    minVolume: 50,
    minDTE: 3,
    maxDTE: 21,
    maxThetaBurnPct: 0.15,
    maxSpreadPct: 0.25,
    allowReddit: true,
    allowLeaps: false,
    allowPuts: true,
    allowYolo: true,
  },
  Lotto: {
    maxContractCost: 500,
    minDelta: 0.05,
    maxIV: 3,
    minOI: 25,
    minVolume: 10,
    minDTE: 0,
    maxDTE: 7,
    maxThetaBurnPct: 1,
    maxSpreadPct: 0.5,
    allowReddit: true,
    allowLeaps: false,
    allowPuts: true,
    allowYolo: true,
  },
};

export const PRESET_ORDER: RiskPresetKey[] = ["Conservative", "Balanced", "Aggressive", "Lotto"];

export const DEFAULT_PRESET: RiskPresetKey = "Balanced";

interface PersistedState {
  preset: RiskPresetKey | "Custom";
  filters: RiskFilters;
  /** When true, manual risk filters are bypassed and the AI/scoring layer
   * decides what is shown. Default: true (AI picks). */
  auto: boolean;
}

const STORAGE_KEY = "risk-filters-v1";
const EVENT = "risk-filters-changed";

export function getDefaultState(): PersistedState {
  return { preset: DEFAULT_PRESET, filters: { ...RISK_PRESETS[DEFAULT_PRESET] }, auto: true };
}

export function readRiskState(): PersistedState {
  if (typeof window === "undefined") return getDefaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!parsed?.filters) return getDefaultState();
    return {
      preset: parsed.preset ?? "Custom",
      filters: { ...getDefaultState().filters, ...parsed.filters },
      // Legacy state (pre-auto) had no `auto` field — preserve its manual
      // behavior so existing users aren't surprised. New installs default to auto.
      auto: typeof parsed.auto === "boolean" ? parsed.auto : false,
    };
  } catch {
    return getDefaultState();
  }
}

export function writeRiskState(state: PersistedState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function subscribeRiskState(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Apply the active filter set to a single TradeCandidate. */
export function passesRiskFilters(t: TradeCandidate, f: RiskFilters): boolean {
  const c = t.contract;
  if (!c) return true;
  // Layer toggles
  if (!f.allowPuts && t.direction === "PUT") return false;
  const isLeaps = t.setupType === "LEAPS" || c.dte > 180;
  if (!f.allowLeaps && isLeaps) return false;
  const isYolo = t.setupType === "Reddit YOLO" || c.dte <= 2;
  if (!f.allowYolo && isYolo) return false;
  if (!f.allowReddit && (t.redditSentiment === "Bullish" || t.redditSentiment === "Bearish")) {
    // Reddit layer off → only block when reddit is the *primary* signal; here we keep all but flag.
    // To keep filter intent strict, drop only when reddit is the dominant trigger keyword.
    if (/reddit/i.test(t.entryTrigger ?? "")) return false;
  }

  if (c.cost > f.maxContractCost) return false;
  if (Math.abs(c.delta) < f.minDelta) return false;
  if (c.iv > f.maxIV) return false;
  if (c.openInterest < f.minOI) return false;
  if (c.volume < f.minVolume) return false;
  if (c.dte < f.minDTE || c.dte > f.maxDTE) {
    // LEAPS bypass the short-term DTE band when LEAPS layer is allowed.
    if (!(f.allowLeaps && isLeaps)) return false;
  }
  if (c.thetaBurnPct > f.maxThetaBurnPct) return false;
  if (c.spreadPct > f.maxSpreadPct) return false;
  return true;
}

export function applyRiskFilters<T extends TradeCandidate>(list: T[], f: RiskFilters): T[] {
  return list.filter((t) => passesRiskFilters(t, f));
}
