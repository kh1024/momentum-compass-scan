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
  const [state, setState] = useState(() => readRiskState());

  useEffect(() => {
    const unsub = subscribeRiskState(() => setState(readRiskState()));
    return unsub;
  }, []);

  const applyPreset = useCallback((key: RiskPresetKey) => {
    writeRiskState({ preset: key, filters: { ...RISK_PRESETS[key] } });
  }, []);

  const setFilter = useCallback(<K extends keyof RiskFilters>(key: K, value: RiskFilters[K]) => {
    const current = readRiskState();
    const next: RiskFilters = { ...current.filters, [key]: value };
    writeRiskState({ preset: "Custom", filters: next });
  }, []);

  const reset = useCallback(() => {
    writeRiskState({ preset: DEFAULT_PRESET, filters: { ...RISK_PRESETS[DEFAULT_PRESET] } });
  }, []);

  return {
    filters: state.filters,
    preset: state.preset,
    applyPreset,
    setFilter,
    reset,
  };
}
