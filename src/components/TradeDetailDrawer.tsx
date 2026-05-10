import type { TradeCandidate } from "@/lib/types";
import type { DisciplineGateResult } from "@/lib/disciplineGate";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabelChip, DirectionChip } from "./Badges";
import { cn } from "@/lib/utils";

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
  if (!t || !gate) return null;
  const c = t.contract;
  const mid = c.mid ?? (c.bid + c.ask) / 2;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-bold">{t.ticker}</span>
            <DirectionChip direction={t.direction} />
            <LabelChip label={t.label} />
            <span className="mono text-sm text-muted-foreground">${t.price.toFixed(2)}</span>
          </SheetTitle>
          <SheetDescription>{t.setupType} · Final score {gate.finalScore}</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="contract">Contract</TabsTrigger>
            <TabsTrigger value="entry">Entry/Exit</TabsTrigger>
            <TabsTrigger value="validation">Validation</TabsTrigger>
            <TabsTrigger value="debug">Debug</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3 pt-4">
            <Section title="Setup">
              <KV k="Setup type" v={t.setupType} />
              <KV k="Final score" v={String(gate.finalScore)} />
              <KV k="Final label" v={gate.finalLabel} />
              <KV k="Trigger status" v={t.triggerStatus ?? "—"} />
            </Section>
            <Section title="Thesis">
              <p className="text-xs">{t.trend}</p>
              <p className="text-xs"><span className="text-muted-foreground">Why {t.direction === "CALL" ? "bullish" : "bearish"}:</span> {t.sectorConfirmation}</p>
            </Section>
            <Section title="Support / Resistance">
              <KV k="Pivot" v={`$${t.levels.pivot.toFixed(2)}`} />
              <KV k="Base high / low" v={`$${t.levels.baseHigh.toFixed(2)} / $${t.levels.baseLow.toFixed(2)}`} />
              <KV k="R1 / R2" v={`$${t.levels.r1.toFixed(2)} / $${t.levels.r2.toFixed(2)}`} />
              <KV k="S1 / S2" v={`$${t.levels.s1.toFixed(2)} / $${t.levels.s2.toFixed(2)}`} />
              <KV k="20/50/200 DMA" v={`$${t.levels.dma20.toFixed(2)} / $${t.levels.dma50.toFixed(2)} / $${t.levels.dma200.toFixed(2)}`} />
            </Section>
          </TabsContent>

          <TabsContent value="contract" className="space-y-3 pt-4">
            <Section title="Contract">
              <KV k="Expiration" v={c.expiration} />
              <KV k="Strike" v={`$${c.strike}`} />
              <KV k="DTE" v={`${c.dte}d`} />
              <KV k="Bid / Ask / Mid" v={`$${c.bid.toFixed(2)} / $${c.ask.toFixed(2)} / $${mid.toFixed(2)}`} />
              <KV k="Ask cost / Mid cost" v={`$${(c.ask * 100).toFixed(0)} / $${(mid * 100).toFixed(0)}`} />
              <KV k="Breakeven" v={`$${c.breakeven.toFixed(2)} (${(c.breakevenMovePct * 100).toFixed(1)}% move)`} />
            </Section>
            <Section title="Greeks">
              <KV k="Delta" v={c.delta.toFixed(2)} />
              <KV k="Theta" v={c.theta.toFixed(2)} />
              <KV k="Gamma" v={c.gamma.toFixed(3)} />
              <KV k="Vega" v={c.vega.toFixed(2)} />
              <KV k="IV" v={`${(c.iv * 100).toFixed(0)}%`} />
              <KV k="Theta burn" v={`${(c.thetaBurnPct * 100).toFixed(1)}%/d`} />
            </Section>
            <Section title="Liquidity">
              <KV k="Volume" v={c.volume.toLocaleString()} />
              <KV k="Open interest" v={c.openInterest.toLocaleString()} />
              <KV k="Spread" v={`${(c.spreadPct * 100).toFixed(1)}%`} />
            </Section>
          </TabsContent>

          <TabsContent value="entry" className="space-y-3 pt-4">
            <Section title="Entry">
              <KV k="Entry trigger" v={t.entryTrigger} />
              <KV k="Invalidation" v={t.invalidation} />
              <KV k="Entry strategy" v={t.entryStrategy} />
            </Section>
            <Section title="Exit">
              <KV k="Target 1 / 2" v={`$${t.target1.toFixed(2)} / $${t.target2.toFixed(2)}`} />
              <KV k="Profit plan" v={t.profitPlan} />
              <KV k="Exit / stop" v={t.exitStrategy} />
              <KV k="Sizing" v={t.sizing} />
            </Section>
            {t.keyRisks.length > 0 && (
              <Section title="Key risks">
                <ul className="ml-4 list-disc space-y-0.5 text-xs">
                  {t.keyRisks.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </Section>
            )}
          </TabsContent>

          <TabsContent value="validation" className="space-y-3 pt-4">
            <Section title="Buy Now eligibility">
              <KV k="Eligible" v={gate.buyNowEligible ? "Yes" : "No"} />
              {gate.buyNowBlockers.length === 0
                ? <p className="text-xs text-[var(--color-bull)]">All checks passed.</p>
                : (
                  <ul className="ml-4 list-disc space-y-0.5 text-xs text-[var(--color-bear)]">
                    {gate.buyNowBlockers.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                )}
            </Section>
            <Section title="Trigger / contract fit">
              <KV k="Trigger status" v={t.triggerStatus ?? "—"} />
              <KV k="Final trigger used" v={t.finalTriggerUsedForLabel ?? "—"} />
              <KV k="Entry mode" v={t.entryMode ?? "—"} />
              <KV k="Selected contract mode" v={t.selectedContractMode ?? "—"} />
              <KV k="Fits entry mode" v={t.selectedContractFitsEntryMode === false ? "No" : "Yes"} />
            </Section>
            <Section title="Breakeven realism">
              <KV k="Breakeven move" v={`${(c.breakevenMovePct * 100).toFixed(1)}%`} />
              <KV k="Threshold" v="≤ 8% for Buy Now" />
            </Section>
            <Section title="Data verification">
              <KV k="Source" v={c.source ?? "mock-seed"} />
              <KV k="Broker confirm required" v={c.brokerConfirmRequired ? "Yes" : "No"} />
              <KV k="Cost validation" v={c.costValidationStatus ?? "unknown"} />
              <KV k="Missing fields" v={(c.missingFields ?? []).join(", ") || "—"} />
            </Section>
          </TabsContent>

          <TabsContent value="debug" className="space-y-3 pt-4">
            <Section title="Discipline gate">
              <KV k="Base label" v={gate.baseLabel} />
              <KV k="Final label" v={gate.finalLabel} />
              <KV k="Display label" v={gate.displayLabel} />
              <KV k="Routed section" v={gate.routedSection} />
              <KV k="Visible" v={gate.visible ? "yes" : "no"} />
            </Section>
            <Section title="Scores">
              <KV k="Setup" v={String(gate.setupScore)} />
              <KV k="Contract" v={`${gate.contractScore}/35`} />
              <KV k="Trigger" v={`${gate.triggerScore}/10`} />
              <KV k="Risk/Reward" v={`${gate.riskRewardScore}/10`} />
              <KV k="Data quality" v={`${gate.dataQualityScore}/10`} />
              <KV k="Validation penalty" v={String(t.validationPenalty ?? 0)} />
              <KV k="Final tradable" v={String(gate.finalScore)} />
            </Section>
            {(t.scorePenalties ?? []).length > 0 && (
              <Section title="Penalties">
                <ul className="ml-4 list-disc space-y-0.5 text-xs text-[var(--color-watch)]">
                  {t.scorePenalties!.map((p, i) => <li key={i}>{p.reason} ({p.delta})</li>)}
                </ul>
              </Section>
            )}
            <Section title="Routing">
              <KV k="DTE" v={String(gate.dte)} />
              <KV k="DTE bucket" v={gate.bucket} />
              <KV k="Source" v={gate.source} />
            </Section>
            <Section title="Invariants">
              <ul className="space-y-0.5 text-xs">
                {gate.invariants.map((i) => (
                  <li key={i.id} className={cn("flex gap-2", i.pass ? "text-muted-foreground" : "text-[var(--color-bear)]")}>
                    <span className="mono w-6">#{i.id}</span>
                    <span className="w-12">{i.pass ? "PASS" : "FAIL"}</span>
                    <span>{i.name}{i.reason ? ` — ${i.reason}` : ""}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="mono text-right text-foreground">{v}</span>
    </div>
  );
}
