import { createFileRoute } from "@tanstack/react-router";
import {
  publicConfigured,
  fetchPublicQuote,
  isPublicRateLimited,
  getPublicCooldownStatus,
} from "@/lib/publicCom.server";

export const Route = createFileRoute("/api/providers/public/status")({
  server: {
    handlers: {
      GET: async () => {
        const checkedAt = new Date().toISOString();
        if (!publicConfigured()) {
          return Response.json({
            provider: "public", configured: false, ok: false, mode: "demo",
            latencyMs: null, rateLimited: false, retryInMs: 0, retryAt: null,
            message: "Public.com is not configured.",
            checkedAt,
          });
        }

        const cooldown = getPublicCooldownStatus();
        if (cooldown.rateLimited) {
          return Response.json({
            provider: "public", configured: true, ok: false, mode: "demo",
            latencyMs: null,
            rateLimited: true,
            retryInMs: cooldown.remainingMs,
            retryAt: cooldown.retryAt,
            message: `Public.com is rate-limiting requests. Retrying in ${Math.ceil(cooldown.remainingMs / 1000)}s.`,
            checkedAt,
          });
        }

        const started = Date.now();
        try {
          const quote = await fetchPublicQuote("SPY");
          const latencyMs = Date.now() - started;
          const ok = !!quote;
          return Response.json({
            provider: "public", configured: true, ok,
            mode: ok ? "live" : "demo",
            latencyMs,
            rateLimited: false, retryInMs: 0, retryAt: null,
            sample: quote ? { symbol: quote.symbol, price: quote.price, ts: quote.ts } : null,
            message: ok ? null : "Public.com returned no quote — using demo data.",
            checkedAt,
          });
        } catch (e) {
          const latencyMs = Date.now() - started;
          if (isPublicRateLimited(e)) {
            return Response.json({
              provider: "public", configured: true, ok: false, mode: "demo",
              latencyMs,
              rateLimited: true,
              retryInMs: e.retryAfterMs,
              retryAt: e.retryAt,
              message: e.message,
              checkedAt,
            });
          }
          return Response.json(
            {
              provider: "public", configured: true, ok: false, mode: "demo",
              latencyMs,
              rateLimited: false, retryInMs: 0, retryAt: null,
              message: "Public.com is temporarily unavailable — using demo data.",
              error: e instanceof Error ? e.message : String(e),
              checkedAt,
            },
            { status: 200 }, // never 502 — the dashboard handles this gracefully
          );
        }
      },
    },
  },
});
