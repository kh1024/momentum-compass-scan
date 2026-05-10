import { useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePatternExplain } from "@/hooks/usePatternExplain";

interface Props {
  ticker: string;
  pattern: string;
  bias: "Bullish" | "Bearish";
  trigger?: number;
  target?: number;
}

export function PatternWhy({ ticker, pattern, bias, trigger, target }: Props) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, error, refetch } = usePatternExplain({
    ticker,
    pattern,
    bias,
    trigger,
    target,
    enabled: open,
  });

  const isBull = bias === "Bullish";
  const tone = isBull ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]";

  return (
    <div className="mt-3 border-t border-border pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider transition hover:opacity-80",
          tone,
        )}
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          Why {bias.toLowerCase()}?
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="mt-2 rounded-md bg-muted/30 p-3 text-xs">
          {isLoading && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:240ms]" />
              <span className="ml-2">Asking AI…</span>
            </div>
          )}

          {!isLoading && (isError || data?.error) && (
            <div className="space-y-1.5">
              <p className="text-[var(--color-bear)]">
                {data?.error ?? (error instanceof Error ? error.message : "Failed to load")}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-background"
              >
                Retry
              </button>
            </div>
          )}

          {!isLoading && data?.data && (
            <div className="space-y-2">
              <Bullet label="Catalyst" value={data.data.catalyst} />
              <Bullet label="Technical" value={data.data.technical} />
              <Bullet label="Sentiment" value={data.data.sentiment} />
              <p className="pt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                AI · routed via Lovable AI Gateway
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Bullet({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs text-foreground">{value}</div>
    </div>
  );
}
