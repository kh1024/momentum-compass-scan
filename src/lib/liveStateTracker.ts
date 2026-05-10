/**
 * Session-scoped sticky tracker for which symbols have ever returned a live
 * signal (quote or chain). Once a symbol has gone "live", we never let the UI
 * flip back to DEMO during the same session — only LIVE → STALE → LIVE on
 * transient misses.
 *
 * Lives on the client (module-level Set). Resets on full reload.
 */

type LiveSource = "quote" | "chain";

interface Entry {
  /** epoch ms of the most recent successful overlay */
  lastSeenAt: number;
  sources: Set<LiveSource>;
}

const everLive = new Map<string, Entry>();

/** How long after the last live overlay we still call it "live" vs "stale". */
const LIVE_FRESHNESS_MS = 2 * 60_000;

export function markLive(symbol: string, source: LiveSource): void {
  const sym = symbol.toUpperCase();
  const e = everLive.get(sym);
  const now = Date.now();
  if (e) {
    e.lastSeenAt = now;
    e.sources.add(source);
  } else {
    everLive.set(sym, { lastSeenAt: now, sources: new Set([source]) });
  }
}

export function liveStateFor(symbol: string): "live" | "stale" | "demo" {
  const e = everLive.get(symbol.toUpperCase());
  if (!e) return "demo";
  return Date.now() - e.lastSeenAt <= LIVE_FRESHNESS_MS ? "live" : "stale";
}

export function hasEverBeenLive(symbol: string): boolean {
  return everLive.has(symbol.toUpperCase());
}

/** True if at least one symbol in `syms` (or any tracked symbol) has been live. */
export function anySymbolLive(syms?: string[]): boolean {
  if (!syms) return everLive.size > 0;
  return syms.some((s) => everLive.has(s.toUpperCase()));
}
