import { useEffect, useState, useCallback } from "react";
import {
  readRiskState,
  writeRiskState,
  subscribeRiskState,
  RISK_PRESETS,
  DEFAULT_PRESET,
  type RiskFilters,
  type RiskPresetKey,
} from "@/lib/riskFilters";

/**
 * React hook that exposes the active app-wide risk filters and lets callers
 * mutate them. State is persisted to localStorage and broadcast across the
 * app so every list view updates immediately.
 */
export function useRiskFilters() {
  // Start from defaults on every first render so SSR and the client's first
  // paint produce identical HTML. After mount we hydrate from localStorage
  // and subscribe to changes.
  const [state, setState] = useState(() => ({
    preset: DEFAULT_PRESET as ReturnType<typeof readRiskState>["preset"],
    filters: { ...RISK_PRESETS[DEFAULT_PRESET] },
    auto: true,
  }));

  useEffect(() => {
    setState(readRiskState());
    const unsub = subscribeRiskState(() => setState(readRiskState()));
    return unsub;
  }, []);

  const applyPreset = useCallback((key: RiskPresetKey) => {
    const cur = readRiskState();
    writeRiskState({ preset: key, filters: { ...RISK_PRESETS[key] }, auto: cur.auto });
  }, []);

  const setFilter = useCallback(<K extends keyof RiskFilters>(key: K, value: RiskFilters[K]) => {
    const current = readRiskState();
    const next: RiskFilters = { ...current.filters, [key]: value };
    // Touching a manual filter switches off auto mode so the change takes effect.
    writeRiskState({ preset: "Custom", filters: next, auto: false });
  }, []);

  const setAuto = useCallback((auto: boolean) => {
    const cur = readRiskState();
    writeRiskState({ ...cur, auto });
  }, []);

  const reset = useCallback(() => {
    writeRiskState({ preset: DEFAULT_PRESET, filters: { ...RISK_PRESETS[DEFAULT_PRESET] }, auto: true });
  }, []);

  return {
    filters: state.filters,
    preset: state.preset,
    auto: state.auto,
    applyPreset,
    setFilter,
    setAuto,
    reset,
  };
}
