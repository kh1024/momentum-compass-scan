import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { explainTrade, type NovaResult } from "@/lib/nova.functions";
import type { TradeCandidate } from "@/lib/types";

export function NovaExplainer({ t }: { t: TradeCandidate }) {
  const explain = useServerFn(explainTrade);
  const [result, setResult] = useState<NovaResult | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      explain({
        data: {
          ticker: t.ticker,
          direction: t.direction,
          setupType: t.setupType,
          score: t.score,
          label: t.label,
          price: t.price,
          trend: t.trend,
          contract: {
            strike: t.contract.strike,
            expiration: t.contract.expiration,
            dte: t.contract.dte,
            ask: t.contract.ask,
            iv: t.contract.iv,
            delta: t.contract.delta,
            thetaBurnPct: t.contract.thetaBurnPct,
            spreadPct: t.contract.spreadPct,
            breakeven: t.contract.breakeven,
            breakevenMovePct: t.contract.breakevenMovePct,
            openInterest: t.contract.openInterest,
            volume: t.contract.volume,
          },
          entryTrigger: t.entryTrigger,
          invalidation: t.invalidation,
        },
      }),
    onSuccess: (res) => {
      setResult(res);
      if (!res.ok) {
        if (res.paymentRequired) toast.error("Nova is out of credits", { description: res.message ?? undefined });
        else if (res.rateLimited) toast.warning("Nova is busy", { description: res.message ?? undefined });
        else toast.error("Nova couldn't generate", { description: res.message ?? undefined });
      }
    },
    onError: (e) => {
      toast.error("Nova request failed", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    },
  });

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Nova explanation</h3>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Routed via Lovable AI Gateway · no key needed
          </p>
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {mutation.isPending ? "Asking Nova…" : result?.ok ? "Re-explain" : "Ask Nova"}
        </button>
      </div>

      {!result && !mutation.isPending && (
        <p className="text-xs text-muted-foreground">
          Get a plain-English read on this setup: thesis, why this contract, key risk, verdict.
        </p>
      )}

      {result?.ok && result.explanation && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.explanation}</p>
      )}

      {result && !result.ok && (
        <p className="text-xs text-[var(--color-bear)]">{result.message}</p>
      )}

      {result?.ok && (
        <p className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">
          {result.model} · {result.latencyMs}ms
        </p>
      )}
    </section>
  );
}
