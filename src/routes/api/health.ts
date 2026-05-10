import { createFileRoute } from "@tanstack/react-router";
import { probeAllProviders, type ProviderHealth } from "@/lib/providers.server";

export type BackendStatus = "healthy" | "degraded" | "offline";

export interface HealthResponse {
  status: BackendStatus;
  checkedAt: string;
  latencyMs: number;
  providers: ProviderHealth[];
  liveProviders: number;
  configuredProviders: number;
  message: string;
  cached?: boolean;
}

const HEALTH_CACHE_MS = 15_000;
const GLOBAL_TIMEOUT_MS = 4_000;
let cached: { at: number; payload: HealthResponse } | null = null;
let inFlight: Promise<HealthResponse> | null = null;

function buildPayload(providers: ProviderHealth[], started: number): HealthResponse {
  const configuredProviders = providers.filter((p) => p.configured).length;
  const liveProviders = providers.filter((p) => p.ok).length;
  let status: BackendStatus;
  let message: string;
  if (liveProviders === 0) {
    status = "offline";
    message = "No data providers are reachable. Scanner will use the last cached snapshot.";
  } else if (liveProviders < Math.max(1, Math.ceil(configuredProviders / 2))) {
    status = "degraded";
    message = `${liveProviders} of ${configuredProviders} data sources online — coverage may be limited.`;
  } else {
    status = "healthy";
    message = `${liveProviders} of ${configuredProviders} data sources online.`;
  }
  return {
    status,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    providers,
    liveProviders,
    configuredProviders,
    message,
  };
}

async function runProbe(): Promise<HealthResponse> {
  const started = Date.now();
  const probePromise = probeAllProviders();
  const timeout = new Promise<ProviderHealth[]>((resolve) =>
    setTimeout(() => resolve([]), GLOBAL_TIMEOUT_MS),
  );
  let providers: ProviderHealth[];
  try {
    providers = await Promise.race([probePromise, timeout]);
    // If the race timed out, the probe is still running — fall back to empty,
    // but let the background promise finish so the cache gets fresh data soon.
    probePromise.then((p) => {
      cached = { at: Date.now(), payload: buildPayload(p, started) };
    }).catch(() => {/* ignored */});
  } catch (e) {
    return {
      status: "offline",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      providers: [],
      liveProviders: 0,
      configuredProviders: 0,
      message: e instanceof Error ? e.message : "Provider probe failed",
    };
  }
  const payload = buildPayload(providers, started);
  cached = { at: Date.now(), payload };
  return payload;
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "1";

        // Serve cached payload if fresh and not explicitly forced.
        if (!force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
          return Response.json(
            { ...cached.payload, cached: true } satisfies HealthResponse,
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        // Dedup concurrent probes so a refresh storm only fires one upstream wave.
        if (!inFlight) {
          inFlight = runProbe().finally(() => { inFlight = null; });
        }
        const payload = await inFlight;
        return Response.json(payload satisfies HealthResponse, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
