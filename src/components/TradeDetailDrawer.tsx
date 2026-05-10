import type { TradeCandidate } from "@/lib/types";
import type { DisciplineGateResult } from "@/lib/disciplineGate";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { displayLabelFor, DISPLAY_LABEL_STYLES, badgesFor, aiThesis, holdTimeframe, riskLevel } from "@/lib/uiVocabulary";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";

export function TradeDetailDrawer({
  open,
  onOpenChange,
  t,
  gate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  t: TradeCandidate | null;
  gate: DisciplineGateResult | null;
}) {
  const [devMode, setDevMode] = useDeveloperMode();

  if (!t || !gate) return null;
  const c = t.contract;
  const mid = c.mid ?? (c.bid + c.ask) / 2;
  const display = displayLabelFor(t.label);
  const styles = DISPLAY_LABEL_STYLES[display];
  const badges = badgesFor(t);

  const bullCase = t.direction === "CALL" ? (t.sectorConfirmation || t.trend) : t.invalidation;
  const bearCase = t.direction === "PUT" ? (t.sectorConfirmation || t.trend) : t.invalidation;

  const expectedMovePct = c.breakevenMovePct;
  const score = gate.finalScore;

  // Sub-score bars (out of 10 scale).
  const bars = [
    { k: "Momentum",   v: Math.min(10, Math.round(((t.setupScore ?? score) / 10))) },
    { k: "Liquidity",  v: gate.dataQualityScore },
    { k: "Risk/Reward", v: gate.riskRewardScore },
    { k: "Regime",     v: t.label === "Buy Now" || t.label === "Watchlist" ? 8 : 5 },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-bold">{t.ticker}</span>
            <span className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[11px] font-bold",
              t.direction === "CALL"
                ? "bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
                : "bg-[var(--color-bear)]/10 text-[var(--color-bear)]",
            )}>{t.direction}</span>
            <span className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              styles.chip,
            )}>{display}</span>
            <span className="font-mono text-sm text-muted-foreground">${t.price.toFixed(2)}</span>
          </SheetTitle>
          <SheetDescription>
            {t.setupType} · AI confidence {score}/100 · {holdTimeframe(t)} · {riskLevel(t)} risk
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* AI Thesis */}
          <Section title="Why AI likes this trade">
            <p className="text-sm leading-relaxed text-foreground/90">{aiThesis(t)}</p>
          </Section>

          {/* Confidence bars */}
          <Section title="Confidence breakdown">
            <div className="space-y-1.5">
              {bars.map((b) => (
                <div key={b.k} className="flex items-center gap-3 text-xs">
                  <span className="w-24 shrink-0 text-muted-foreground">{b.k}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        b.v >= 8 ? "bg-[var(--color-bull)]"
                        : b.v >= 5 ? "bg-amber-500"
                        : "bg-[var(--color-bear)]",
                      )}
                      style={{ width: `${(b.v / 10) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono tabular-nums text-foreground/70">{b.v}/10</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Bull / Bear */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Section title="Bull case" tone="bull">
              <p className="text-xs leading-relaxed">{bullCase || "Continuation of trend with sector support."}</p>
            </Section>
            <Section title="Bear case" tone="bear">
              <p className="text-xs leading-relaxed">{bearCase || "Reversal at resistance or sector rotation."}</p>
            </Section>
          </div>

          {/* Quick stats */}
          <Section title="Trade snapshot">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              <KV k="Strike" v={`$${c.strike}`} />
              <KV k="Expiration" v={c.expiration} />
              <KV k="DTE" v={`${c.dte}d`} />
              <KV k="Ask" v={`$${c.ask.toFixed(2)}`} />
              <KV k="Mid" v={`$${mid.toFixed(2)}`} />
              <KV k="Cost" v={`$${(c.ask * 100).toFixed(0)}`} />
              <KV k="Breakeven" v={`$${c.breakeven.toFixed(2)}`} />
              <KV k="Expected move" v={`${(expectedMovePct * 100).toFixed(1)}%`} vClass={expectedMovePct > 0.08 ? "text-amber-500" : undefined} />
              <KV k="Hold timeframe" v={holdTimeframe(t)} />
            </div>
          </Section>

          {/* Badges */}
          {badges.length > 0 && (
            <Section title="Quick read">
              <div className="flex flex-wrap gap-1.5">
                {badges.map((b) => (
                  <span
                    key={b.kind}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      b.tone === "good" ? "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
                      : b.tone === "warn" ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                      : b.tone === "danger" ? "border-[var(--color-bear)]/40 bg-[var(--color-bear)]/10 text-[var(--color-bear)]"
                      : "border-border bg-muted/30 text-muted-foreground",
                    )}
                  >
                    {b.label}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Key risks */}
          {t.keyRisks.length > 0 && (
            <Section title="Key risk warnings">
              <ul className="ml-4 list-disc space-y-1 text-xs leading-relaxed text-foreground/80">
                {t.keyRisks.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </Section>
          )}

          {/* Developer Mode toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
            <div>
              <div className="text-xs font-semibold">Developer Mode</div>
              <div className="text-[10px] text-muted-foreground">Show validation pipeline, blockers, invariants, sub-scores.</div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={devMode}
                onChange={(e) => setDevMode(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--color-bull)]"
              />
              <span className="text-muted-foreground">{devMode ? "On" : "Off"}</span>
            </label>
          </div>

          {/* DEV-only diagnostics */}
          {devMode && (
            <>
              <Section title="Discipline Gate (debug)">
                <KV k="Base label" v={gate.baseLabel} />
                <KV k="Final label" v={gate.finalLabel} />
                <KV k="Display label" v={gate.displayLabel} />
                <KV k="Routed section" v={gate.routedSection} />
                <KV k="Visible" v={gate.visible ? "yes" : "no"} />
              </Section>
              <Section title="Sub-scores (debug)">
                <div className="grid grid-cols-2 gap-x-4">
                  <KV k="Setup" v={String(gate.setupScore)} />
                  <KV k="Contract" v={`${gate.contractScore}/35`} />
                  <KV k="Risk/Reward" v={`${gate.riskRewardScore}/10`} />
                  <KV k="Data quality" v={`${gate.dataQualityScore}/10`} />
                  <KV k="Validation penalty" v={String(t.validationPenalty ?? 0)} />
                  <KV k="Final score" v={String(gate.finalScore)} />
                </div>
              </Section>
              {(gate.buyNowBlockers ?? []).length > 0 && (
                <Section title="Blockers (debug)" tone="bear">
                  <ul className="ml-3 list-disc space-y-0.5 text-[11px]">
                    {gate.buyNowBlockers.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </Section>
              )}
              {(t.scorePenalties ?? []).length > 0 && (
                <Section title="Penalties (debug)">
                  <ul className="ml-3 list-disc space-y-0.5 text-[11px] text-amber-500/80">
                    {t.scorePenalties!.map((p, i) => <li key={i}>{p.reason} ({p.delta})</li>)}
                  </ul>
                </Section>
              )}
              <Section title="Routing (debug)">
                <KV k="DTE" v={String(gate.dte)} />
                <KV k="DTE bucket" v={gate.bucket} />
                <KV k="Source" v={gate.source} />
                <KV k="Broker confirm" v={c.brokerConfirmRequired ? "Yes" : "No"} />
                <KV k="Missing fields" v={(c.missingFields ?? []).join(", ") || "—"} />
              </Section>
              <Section title="Invariants (debug)">
                <div className="space-y-0.5">
                  {gate.invariants.map((inv) => (
                    <div key={inv.id} className={cn("flex items-start gap-2 text-[11px]", inv.pass ? "text-muted-foreground/60" : "text-[var(--color-bear)]")}>
                      <span className="w-5 shrink-0 font-mono text-[10px] tabular-nums">#{inv.id}</span>
                      <span className={cn("w-8 shrink-0 text-[10px] font-bold", inv.pass ? "text-[var(--color-bull)]/60" : "text-[var(--color-bear)]")}>
                        {inv.pass ? "PASS" : "FAIL"}
                      </span>
                      <span>{inv.name}{inv.reason ? ` — ${inv.reason}` : ""}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children, tone }: { title: string; children: React.ReactNode; tone?: "bull" | "bear" }) {
  const cls = tone === "bull"
    ? "border-[var(--color-bull)]/30 bg-[var(--color-bull)]/5"
    : tone === "bear"
      ? "border-[var(--color-bear)]/30 bg-[var(--color-bear)]/5"
      : "border-border bg-card";
  return (
    <div className={cn("rounded-lg border p-3", cls)}>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({ k, v, vClass }: { k: string; v: string; vClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={cn("text-right font-mono text-foreground/90", vClass)}>{v}</span>
    </div>
  );
}
