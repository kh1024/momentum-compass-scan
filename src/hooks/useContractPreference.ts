import { useEffect, useState, useCallback } from "react";
import {
  readPreferenceState,
  writePreferenceState,
  subscribePreferenceState,
  DEFAULT_PREFERENCE_STATE,
  type PreferenceMode,
  type PreferenceState,
} from "@/lib/contractPreference";

/**
 * Hook exposing the active contract-preference mode + max cost.
 * Starts from DEFAULT_PREFERENCE_STATE on SSR / first paint to avoid
 * hydration mismatches, then syncs to localStorage after mount.
 */
export function useContractPreference() {
  const [state, setState] = useState<PreferenceState>(() => ({ ...DEFAULT_PREFERENCE_STATE }));

  useEffect(() => {
    setState(readPreferenceState());
    return subscribePreferenceState(() => setState(readPreferenceState()));
  }, []);

  const setMode = useCallback((mode: PreferenceMode) => {
    const cur = readPreferenceState();
    writePreferenceState({ ...cur, mode });
  }, []);

  const setMaxCost = useCallback((maxContractCost: number) => {
    const cur = readPreferenceState();
    writePreferenceState({ ...cur, maxContractCost });
  }, []);

  return { mode: state.mode, maxContractCost: state.maxContractCost, setMode, setMaxCost };
}
