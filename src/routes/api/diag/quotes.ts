import { createFileRoute } from "@tanstack/react-router";
import { getConsensusQuotes } from "@/lib/providers.server";
import { validateQuote } from "@/lib/quoteValidation";

/**
 * Live diagnostic: returns consensus quotes + validation status for a set
 * of tickers. Use this to sanity-check that the scanner sees correct prices.
 *   GET /api/diag/quotes?symbols=NVDA,SPY,AAPL,TSLA,QQQ,AMD,MSFT,META
 */
export const Route = createFileRoute("/api/diag/quotes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const raw = (url.searchParams.get("symbols") || "NVDA,SPY,AAPL,TSLA,QQQ,AMD,MSFT,META")
          .split(",").map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 25);
        const t0 = Date.now();
        const quotes = await getConsensusQuotes(raw);
        const now = Date.now();
        const results = raw.map(sym => {
          const q = quotes[sym] ?? null;
          const v = validateQuote(sym, q);
          return {
            symbol: sym,
            consensus: q ? {
              price: q.price,
              source: q.consensusSource,
              agreement: q.agreement,
              diffPct: q.diffPct,
              ts: q.ts,
              ageMs: q.ts ? now - q.ts : null,
              sources: Object.entries(q.sources ?? {}).map(([source, price]) => ({ source, price })),
            } : null,
            validation: {
              status: v.status,
              ok: v.ok,
              rankable: v.rankable,
              price: Number.isFinite(v.price) ? v.price : null,
              source: v.source,
              ageMs: v.ageMs,
              confidence: v.confidence,
              reason: v.reason,
              display: v.display,
            },
          };
        });
        return Response.json({
          checkedAt: new Date(now).toISOString(),
          elapsedMs: now - t0,
          count: results.length,
          verified: results.filter(r => r.validation.status === "verified").length,
          rankable: results.filter(r => r.validation.rankable).length,
          results,
        });
      },
    },
  },
});
