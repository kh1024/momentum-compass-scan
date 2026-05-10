/**
 * In-memory ring buffer of provider 429 events for fast troubleshooting.
 * Per-isolate, capped at MAX entries (oldest dropped first).
 */

export type RateLimitProvider = "massive" | "public";

export interface RateLimitEvent {
  ts: number;             // epoch ms when 429 was received
  provider: RateLimitProvider;
  context: string;        // path / symbol / "snapshot SPY"
  retryAfterMs: number;   // computed cooldown duration
  retryAt: number;        // epoch ms when retry is allowed
  source: "header" | "backoff"; // retry-after header vs computed exp backoff
}

const MAX = 100;
const events: RateLimitEvent[] = [];

export function recordRateLimit(e: Omit<RateLimitEvent, "ts">): void {
  events.unshift({ ts: Date.now(), ...e });
  if (events.length > MAX) events.length = MAX;
  console.warn(
    `[ratelimit] ${e.provider} 429 @ ${e.context} — retry in ${Math.ceil(e.retryAfterMs / 1000)}s (${e.source})`,
  );
}

export function getRateLimitEvents(limit = 50): RateLimitEvent[] {
  return events.slice(0, limit);
}

export function clearRateLimitEvents(): void {
  events.length = 0;
}
