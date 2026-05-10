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

  // Categorize blockers by keyword matching
  const blockers = gate.buyNowBlockers ?? [];
  const triggerBlockers = blockers.filter(b => /trigger|entry|mode|active/i.test(b));
  const contractBlockers = blockers.filter(b => /spread|delta|IV|oi|vol|strike|expir|dte|cost|be\+|break.?even|ask|bid/i.test(b));
  const rrBlockers = blockers.filter(b => /risk|reward|r\/r|target|ratio/i.test(b));
  const dataBlockers = blockers.filter(b => /data|source|missing|demo|mock|broker|confirm|chain/i.test(b));
  const otherBlockers = blockers.filter(b =>
    !triggerBlockers.includes(b) && !contractBlockers.includes(b) &&
    !rrBlockers.includes(b) && !dataBlockers.includes(b)
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-bold">{t.ticker}</span>
            <DirectionChip direction={t.direction} />
            <LabelChip label={t.label} />
            <span className="font-mono text-sm text-muted-foreground">${t.price.toFixed(2)}</span>
          </SheetTitle>
          <SheetDescription>
            {t.setupType} · Score {gate.finalScore}
            {c.source !== "chain" && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-watch)]/70">Demo data</span>}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="contract">Contract</TabsTrigger>
            <TabsTrigger value="entry">Entry/Exit</TabsTrigger>
            <TabsTrigger value="validation">
              Validation
              {blockers.length > 0 && (
                <span className="ml-1.5 rounded-full bg-[var(--color-bear)]/20 px-1 text-[9px] font-bold text-[var(--color-bear)]">
                  {blockers.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="debug">Debug</TabsTrigger>
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview" className="space-y-3 pt-4">
            <Section title="Setup">
              <KV k="Type" v={t.setupType} />
              <KV k="Final score" v={String(gate.finalScore)} />
              <KV k="Label" v={gate.finalLabel} />
              <KV k="Trigger" v={t.triggerStatus ?? "—"} vClass={t.triggerStatus === "active" ? "text-[var(--color-bull)]" : undefined} />
            </Section>
            <Section title="Thesis">
              <p className="text-xs leading-relaxed">{t.trend}</p>
              {t.sectorConfirmation && (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-medium">Sector:</span> {t.sectorConfirmation}
                </p>
              )}
            </Section>
            <Section title="Key Levels">
              <div className="grid grid-cols-2 gap-x-4">
                <KV k="Pivot" v={`$${t.levels.pivot.toFixed(2)}`} />
                <KV k="Base range" v={`$${t.levels.baseLow.toFixed(2)} – $${t.levels.baseHigh.toFixed(2)}`} />
                <KV k="R1 / R2" v={`$${t.levels.r1.toFixed(2)} / $${t.levels.r2.toFixed(2)}`} />
                <KV k="S1 / S2" v={`$${t.levels.s1.toFixed(2)} / $${t.levels.s2.toFixed(2)}`} />
                <KV k="20 DMA" v={`$${t.levels.dma20.toFixed(2)}`} />
                <KV k="50 DMA" v={`$${t.levels.dma50.toFixed(2)}`} />
                <KV k="200 DMA" v={`$${t.levels.dma200.toFixed(2)}`} />
              </div>
            </Section>
          </TabsContent>

          {/* ── Contract ── */}
          <TabsContent value="contract" className="space-y-3 pt-4">
            <Section title="Contract">
              <div className="grid grid-cols-2 gap-x-4">
                <KV k="Expiration" v={c.expiration} />
                <KV k="Strike" v={`$${c.strike}`} />
                <KV k="DTE" v={`${c.dte}d`} />
                <KV k="Bid / Ask / Mid" v={`$${c.bid.toFixed(2)} / $${c.ask.toFixed(2)} / $${mid.toFixed(2)}`} />
                <KV k="Ask cost" v={`$${(c.ask * 100).toFixed(0)}`} />
                <KV k="Mid cost" v={`$${(mid * 100).toFixed(0)}`} />
                <KV k="Breakeven" v={`$${c.breakeven.toFixed(2)}`} />
                <KV k="Breakeven move" v={`${(c.breakevenMovePct * 100).toFixed(1)}%`} vClass={c.breakevenMovePct > 0.08 ? "text-amber-500" : undefined} />
              </div>
            </Section>
            <Section title="Greeks">
              <div className="grid grid-cols-3 gap-x-4">
                <KV k="Delta" v={c.delta.toFixed(2)} />
                <KV k="Theta" v={c.theta.toFixed(2)} />
                <KV k="Gamma" v={c.gamma.toFixed(3)} />
                <KV k="Vega" v={c.vega.toFixed(2)} />
                <KV k="IV" v={`${(c.iv * 100).toFixed(0)}%`} />
                <KV k="Theta/day" v={`${(c.thetaBurnPct * 100).toFixed(2)}%`} />
              </div>
            </Section>
            <Section title="Liquidity">
              <div className="grid grid-cols-3 gap-x-4">
                <KV k="Volume" v={c.volume.toLocaleString()} />
                <KV k="Open interest" v={c.openInterest.toLocaleString()} />
                <KV k="Spread" v={`${(c.spreadPct * 100).toFixed(1)}%`} vClass={c.spreadPct > 0.15 ? "text-[var(--color-bear)]/80" : c.spreadPct > 0.08 ? "text-amber-500" : undefined} />
              </div>
            </Section>
          </TabsContent>

          {/* ── Entry / Exit ── */}
          <TabsContent value="entry" className="space-y-3 pt-4">
            <Section title="Entry">
              <KV k="Trigger" v={t.entryTrigger} />
              <KV k="Strategy" v={t.entryStrategy} />
              <KV k="Invalidation" v={t.invalidation} />
            </Section>
            <Section title="Exit">
              <KV k="Target 1" v={`$${t.target1.toFixed(2)}`} />
              <KV k="Target 2" v={`$${t.target2.toFixed(2)}`} />
              <KV k="Profit plan" v={t.profitPlan} />
              <KV k="Exit / stop" v={t.exitStrategy} />
              <KV k="Sizing" v={t.sizing} />
            </Section>
            {t.keyRisks.length > 0 && (
              <Section title="Key Risks">
                <ul className="ml-4 list-disc space-y-1 text-xs leading-relaxed">
                  {t.keyRisks.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </Section>
            )}
          </TabsContent>

          {/* ── Validation ── */}
          <TabsContent value="validation" className="space-y-3 pt-4">
            <div className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-3",
              gate.buyNowEligible
                ? "border-[var(--color-bull)]/30 bg-[var(--color-bull)]/5"
                : "border-[var(--color-bear)]/30 bg-[var(--color-bear)]/5",
            )}>
              <span className={cn(
                "text-sm font-bold",
                gate.buyNowEligible ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]",
              )}>
                {gate.buyNowEligible ? "Buy Now eligible" : `${blockers.length} blocker${blockers.length !== 1 ? "s" : ""} found`}
              </span>
              {!gate.buyNowEligible && (
                <span className="text-xs text-muted-foreground">— fix all blockers to unlock Buy Now</span>
              )}
            </div>

            {triggerBlockers.length > 0 && (
              <BlockerGroup title="Trigger / Entry" items={triggerBlockers} />
            )}
            {contractBlockers.length > 0 && (
              <BlockerGroup title="Contract Quality" items={contractBlockers} />
            )}
            {rrBlockers.length > 0 && (
              <BlockerGroup title="Risk / Reward" items={rrBlockers} />
            )}
            {dataBlockers.length > 0 && (
              <BlockerGroup title="Data Quality" items={dataBlockers} />
            )}
            {otherBlockers.length > 0 && (
              <BlockerGroup title="Other" items={otherBlockers} />
            )}
            {blockers.length === 0 && (
              <Section title="Checks">
                <p className="text-xs text-[var(--color-bull)]">All buy-now checks passed.</p>
              </Section>
            )}

            <Section title="Trigger / Contract Fit">
              <KV k="Trigger status" v={t.triggerStatus ?? "—"} />
              <KV k="Entry mode" v={t.entryMode ?? "—"} />
              <KV k="Selected contract mode" v={t.selectedContractMode ?? "—"} />
              <KV k="Fits entry mode" v={t.selectedContractFitsEntryMode === false ? "No" : "Yes"} vClass={t.selectedContractFitsEntryMode === false ? "text-[var(--color-bear)]" : undefined} />
            </Section>

            <Section title="Data Verification">
              <KV k="Source" v={c.source ?? "mock-seed"} />
              <KV k="Broker confirm required" v={c.brokerConfirmRequired ? "Yes" : "No"} vClass={c.brokerConfirmRequired ? "text-amber-500" : undefined} />
              <KV k="Cost validation" v={c.costValidationStatus ?? "unknown"} />
              <KV k="Missing fields" v={(c.missingFields ?? []).join(", ") || "—"} />
            </Section>
          </TabsContent>

          {/* ── Debug ── */}
          <TabsContent value="debug" className="space-y-3 pt-4">
            <Section title="Discipline Gate">
              <KV k="Base label" v={gate.baseLabel} />
              <KV k="Final label" v={gate.finalLabel} />
              <KV k="Display label" v={gate.displayLabel} />
              <KV k="Routed section" v={gate.routedSection} />
              <KV k="Visible" v={gate.visible ? "yes" : "no"} />
            </Section>
            <Section title="Scores">
              <div className="grid grid-cols-2 gap-x-4">
                <KV k="Setup" v={String(gate.setupScore)} />
                <KV k="Contract" v={`${gate.contractScore}/35`} />
                <KV k="Trigger" v={`${gate.triggerScore}/10`} />
                <KV k="Risk/Reward" v={`${gate.riskRewardScore}/10`} />
                <KV k="Data quality" v={`${gate.dataQualityScore}/10`} />
                <KV k="Validation penalty" v={String(t.validationPenalty ?? 0)} />
                <KV k="Final score" v={String(gate.finalScore)} />
              </div>
            </Section>
            {(t.scorePenalties ?? []).length > 0 && (
              <Section title="Penalties">
                <ul className="ml-4 list-disc space-y-0.5 text-xs text-amber-500/80">
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
              <div className="space-y-0.5">
                {gate.invariants.map((inv) => (
                  <div key={inv.id} className={cn("flex items-start gap-2 text-xs", inv.pass ? "text-muted-foreground/60" : "text-[var(--color-bear)]")}>
                    <span className="mt-px font-mono text-[10px] w-5 shrink-0 tabular-nums">#{inv.id}</span>
                    <span className={cn("shrink-0 w-8 font-bold text-[10px]", inv.pass ? "text-[var(--color-bull)]/60" : "text-[var(--color-bear)]")}>
                      {inv.pass ? "PASS" : "FAIL"}
                    </span>
                    <span>{inv.name}{inv.reason ? ` — ${inv.reason}` : ""}</span>
                  </div>
                ))}
              </div>
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

function BlockerGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-[var(--color-bear)]/20 bg-[var(--color-bear)]/5 p-3">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-bear)]/70">{title}</h3>
      <ul className="ml-3 list-disc space-y-0.5 text-xs text-[var(--color-bear)]/80">
        {items.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    </div>
  );
}

function KV({ k, v, vClass }: { k: string; v: string; vClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={cn("font-mono text-right text-foreground/90", vClass)}>{v}</span>
    </div>
  );
}
