import { useContractPreference } from "@/hooks/useContractPreference";
import {
  PREFERENCE_LABEL,
  PREFERENCE_DESCRIPTION,
  type PreferenceMode,
} from "@/lib/contractPreference";
import { cn } from "@/lib/utils";

const MODES: PreferenceMode[] = ["Balanced", "Conservative", "Aggressive", "Lottery"];

const COST_PRESETS = [250, 500, 1000, 2500] as const;

/**
 * User-friendly contract-preference toolbar.
 *
 * Lets the user pick the contract selection mode (Balanced / Conservative
 * / Aggressive / Lottery) and the max per-contract premium. Both choices
 * persist to localStorage and feed into chain selection + ranking.
 */
export function ContractPreferenceToolbar() {
  const { mode, maxContractCost, setMode, setMaxCost } = useContractPreference();
  const lotteryActive = mode === "Lottery";

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Contract Style
            </span>
            <span className="text-[11px] text-muted-foreground">
              {PREFERENCE_DESCRIPTION[mode]}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MODES.map((m) => {
              const active = mode === m;
              const lotteryStyle = m === "Lottery";
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-semibold transition",
                    active
                      ? lotteryStyle
                        ? "border-purple-400 bg-purple-400/10 text-purple-300"
                        : "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                  )}
                  title={PREFERENCE_DESCRIPTION[m]}
                >
                  {PREFERENCE_LABEL[m]}
                </button>
              );
            })}
          </div>
          {lotteryActive && (
            <p className="mt-1.5 text-[10px] text-purple-300">
              ⚠ Lottery mode — speculative far-OTM picks only. Expect to lose premium often.
            </p>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Max Cost / Contract
            </span>
            <span className="mono text-[11px] text-foreground">${maxContractCost}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COST_PRESETS.map((v) => {
              const active = maxContractCost === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMaxCost(v)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  ${v}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Contracts above this rank lower and get a Premium Heavy tag.
          </p>
        </div>
      </div>
    </div>
  );
}
