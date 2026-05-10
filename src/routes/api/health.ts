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
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const started = Date.now();
        let providers: ProviderHealth[] = [];
        try {
          providers = await probeAllProviders();
        } catch (e) {
          return Response.json(
            {
              status: "offline" as BackendStatus,
              checkedAt: new Date().toISOString(),
              latencyMs: Date.now() - started,
              providers: [],
              liveProviders: 0,
              configuredProviders: 0,
              message: e instanceof Error ? e.message : "Provider probe failed",
            } satisfies HealthResponse,
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

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

        return Response.json(
          {
            status,
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - started,
            providers,
            liveProviders,
            configuredProviders,
            message,
          } satisfies HealthResponse,
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
