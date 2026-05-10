import type { ScannerMode } from "./disciplineGate";

export type { ScannerMode };

/** Threshold overrides per scanner mode. Buy Now hard rules are ALWAYS strict. */
export interface ModePack {
  /** Hard-Avoid OI floor (chain only). Below this → Avoid Contract. */
  oiAvoidBelow: number;
  /** OI below this (but ≥ oiAvoidBelow) → Near Miss / Watchlist downgrade. */
  oiNearMissBelow: number;
  /** Hard-Avoid volume floor. */
  volAvoidBelow: number;
  /** Volume below this (but ≥ volAvoidBelow) → Near Miss. */
  volNearMissBelow: number;
  /** Hard-Avoid spread ceiling. */
  spreadAvoidAbove: number;
  /** Spread above this (but ≤ spreadAvoidAbove) → Aggressive cap. */
  spreadNearMissAbove: number;
  /** Discovery mode: include YOLO/Reddit setups freely. */
  discoveryMode: boolean;
}

export const MODE_PACKS: Record<ScannerMode, ModePack> = {
  Strict: {
    oiAvoidBelow: 100,
    oiNearMissBelow: 300,
    volAvoidBelow: 50,
    volNearMissBelow: 100,
    spreadAvoidAbove: 0.20,
    spreadNearMissAbove: 0.15,
    discoveryMode: false,
  },
  Balanced: {
    oiAvoidBelow: 100,
    oiNearMissBelow: 300,
    volAvoidBelow: 50,
    volNearMissBelow: 100,
    spreadAvoidAbove: 0.20,
    spreadNearMissAbove: 0.15,
    discoveryMode: false,
  },
  Discovery: {
    oiAvoidBelow: 50,
    oiNearMissBelow: 100,
    volAvoidBelow: 10,
    volNearMissBelow: 50,
    spreadAvoidAbove: 0.30,
    spreadNearMissAbove: 0.20,
    discoveryMode: true,
  },
};

const STORAGE_KEY = "scanner.mode";

export function loadScannerMode(): ScannerMode {
  if (typeof window === "undefined") return "Balanced";
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "Strict" || v === "Balanced" || v === "Discovery") return v;
  return "Balanced";
}

export function saveScannerMode(mode: ScannerMode): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, mode);
}
