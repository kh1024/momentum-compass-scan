/**
 * Dynamic Throttle Controller (AIMD-style adaptive concurrency / backoff).
 *
 * Watches a rolling window of API samples (latency + error rate + 429s) per
 * channel ("massive", "public", …) and continuously re-tunes:
 *   - effective concurrency cap (a multiplier of the configured max)
 *   - extra request spacing (ms added between successive calls)
 *   - backoff multiplier applied to retry waits
 *
 * Heuristic (per channel, evaluated lazily on each read):
 *
 *   Health =
 *      +1   per successful sample in the last WINDOW_MS
 *      −2   per non-rate-limit error sample
 *      −5   per 429 sample
 *      −1   if p95 latency > LAT_DEGRADED_MS
 *      −2   if p95 latency > LAT_CRITICAL_MS
 *
 *   - Health < −3  → degrade: concurrencyMult /= 2, spacing += 400ms,
 *                    backoffMult = min(4, ×1.5)
 *   - Health >  6 and no recent 429 → recover: concurrencyMult ×= 1.25,
 *                                              spacing -= 200ms,
 *                                              backoffMult = max(1, ×0.8)
 *
 * Bounds are clamped so callers always get a usable value even when the
 * window has no samples (e.g. first request after deploy).
 */

export type ThrottleChannel = "massive" | "public";

interface Sample {
  ts: number;
  latencyMs: number;
  ok: boolean;
  rateLimited: boolean;
}

interface ChannelState {
  samples: Sample[];
  concurrencyMult: number; // 0.1 .. 1.0  (fraction of configured cap)
  extraSpacingMs: number;  //   0 .. 2000
  backoffMult: number;     // 1.0 .. 4.0
  lastTunedAt: number;
  lastDegradeAt: number;
  lastRecoverAt: number;
}

const WINDOW_MS = 30_000;
const MAX_SAMPLES = 200;
const LAT_DEGRADED_MS = 1_500;
const LAT_CRITICAL_MS = 3_500;
const TUNE_INTERVAL_MS = 5_000;
const COOLDOWN_AFTER_DEGRADE_MS = 10_000;

const state: Record<ThrottleChannel, ChannelState> = {
  massive: blank(),
  public: blank(),
};

function blank(): ChannelState {
  return {
    samples: [],
    concurrencyMult: 1,
    extraSpacingMs: 0,
    backoffMult: 1,
    lastTunedAt: 0,
    lastDegradeAt: 0,
    lastRecoverAt: 0,
  };
}

function trim(s: ChannelState, now: number): void {
  const cutoff = now - WINDOW_MS;
  // Drop old entries from the head (samples are append-ordered).
  while (s.samples.length > 0 && s.samples[0].ts < cutoff) s.samples.shift();
  if (s.samples.length > MAX_SAMPLES) s.samples.splice(0, s.samples.length - MAX_SAMPLES);
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

function tune(channel: ThrottleChannel, now: number): void {
  const s = state[channel];
  if (now - s.lastTunedAt < TUNE_INTERVAL_MS) return;
  s.lastTunedAt = now;
  trim(s, now);

  if (s.samples.length < 3) return; // not enough signal yet

  let okCount = 0;
  let errCount = 0;
  let rlCount = 0;
  const latencies: number[] = [];
  for (const sample of s.samples) {
    if (sample.rateLimited) rlCount += 1;
    else if (sample.ok) {
      okCount += 1;
      latencies.push(sample.latencyMs);
    } else errCount += 1;
  }
  const p95Latency = p95(latencies);

  let health = okCount - 2 * errCount - 5 * rlCount;
  if (p95Latency > LAT_DEGRADED_MS) health -= 1;
  if (p95Latency > LAT_CRITICAL_MS) health -= 2;

  if (health < -3) {
    // Degrade — back off aggressively
    s.concurrencyMult = Math.max(0.1, s.concurrencyMult / 2);
    s.extraSpacingMs = Math.min(2000, s.extraSpacingMs + 400);
    s.backoffMult = Math.min(4, s.backoffMult * 1.5);
    s.lastDegradeAt = now;
  } else if (health > 6 && rlCount === 0 && now - s.lastDegradeAt > COOLDOWN_AFTER_DEGRADE_MS) {
    // Recover gradually
    s.concurrencyMult = Math.min(1, s.concurrencyMult * 1.25);
    s.extraSpacingMs = Math.max(0, s.extraSpacingMs - 200);
    s.backoffMult = Math.max(1, s.backoffMult * 0.8);
    s.lastRecoverAt = now;
  }
}

export function recordThrottleSample(
  channel: ThrottleChannel,
  latencyMs: number,
  outcome: { ok: boolean; rateLimited?: boolean },
): void {
  const now = Date.now();
  const s = state[channel];
  s.samples.push({ ts: now, latencyMs, ok: outcome.ok, rateLimited: !!outcome.rateLimited });
  trim(s, now);
  // 429 always forces an immediate degrade tick — no need to wait for interval.
  if (outcome.rateLimited) {
    s.concurrencyMult = Math.max(0.1, s.concurrencyMult / 2);
    s.extraSpacingMs = Math.min(2000, s.extraSpacingMs + 500);
    s.backoffMult = Math.min(4, s.backoffMult * 1.5);
    s.lastDegradeAt = now;
    s.lastTunedAt = now;
    return;
  }
  tune(channel, now);
}

export interface ThrottleAdjustment {
  concurrencyMult: number;
  extraSpacingMs: number;
  backoffMult: number;
}

export function getThrottleAdjustment(channel: ThrottleChannel): ThrottleAdjustment {
  tune(channel, Date.now());
  const s = state[channel];
  return { concurrencyMult: s.concurrencyMult, extraSpacingMs: s.extraSpacingMs, backoffMult: s.backoffMult };
}

export interface ThrottleSnapshot extends ThrottleAdjustment {
  channel: ThrottleChannel;
  samples: number;
  p95LatencyMs: number;
  errorRate: number;       // 0..1
  rateLimitedCount: number;
  lastDegradeAt: number | null;
  lastRecoverAt: number | null;
}

export function getThrottleSnapshot(channel: ThrottleChannel): ThrottleSnapshot {
  const s = state[channel];
  trim(s, Date.now());
  let ok = 0;
  let err = 0;
  let rl = 0;
  const lat: number[] = [];
  for (const sample of s.samples) {
    if (sample.rateLimited) rl += 1;
    else if (sample.ok) { ok += 1; lat.push(sample.latencyMs); }
    else err += 1;
  }
  const total = ok + err + rl;
  return {
    channel,
    concurrencyMult: s.concurrencyMult,
    extraSpacingMs: s.extraSpacingMs,
    backoffMult: s.backoffMult,
    samples: total,
    p95LatencyMs: p95(lat),
    errorRate: total === 0 ? 0 : (err + rl) / total,
    rateLimitedCount: rl,
    lastDegradeAt: s.lastDegradeAt || null,
    lastRecoverAt: s.lastRecoverAt || null,
  };
}

export function getAllThrottleSnapshots(): ThrottleSnapshot[] {
  return (Object.keys(state) as ThrottleChannel[]).map(getThrottleSnapshot);
}

export function resetThrottle(channel?: ThrottleChannel): void {
  if (channel) state[channel] = blank();
  else for (const k of Object.keys(state) as ThrottleChannel[]) state[k] = blank();
}
