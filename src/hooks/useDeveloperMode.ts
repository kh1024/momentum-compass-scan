import { useEffect, useState, useCallback } from "react";

const KEY = "scanner-dev-mode";

export function useDeveloperMode(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(false);

  useEffect(() => {
    try {
      setOn(localStorage.getItem(KEY) === "1");
    } catch {
      // ignore
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setOn(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const set = useCallback((v: boolean) => {
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      // ignore
    }
    setOn(v);
  }, []);

  return [on, set];
}
