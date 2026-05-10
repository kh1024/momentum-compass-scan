import { useEffect, useRef, useState } from "react";

/**
 * Holds the previous value for `holdMs` before committing a new one, unless
 * the new value is in `flushImmediate` (terminal/important states that should
 * appear instantly). Useful to prevent rapid label flicker during refresh
 * cycles where transient states (refreshing/connecting) briefly toggle.
 */
export function useStableValue<T>(
  value: T,
  options: {
    holdMs?: number;
    flushImmediate?: (next: T, prev: T) => boolean;
  } = {},
): T {
  const { holdMs = 700, flushImmediate } = options;
  const [committed, setCommitted] = useState<T>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<T>(value);

  useEffect(() => {
    pendingRef.current = value;
    if (Object.is(value, committed)) return;
    if (flushImmediate?.(value, committed)) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setCommitted(value);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCommitted(pendingRef.current);
    }, holdMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value, committed, holdMs, flushImmediate]);

  return committed;
}
