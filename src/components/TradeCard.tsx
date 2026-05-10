import type { TradeCandidate } from "@/lib/types";
import type { UpcomingEarnings } from "@/lib/earnings.functions";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ScoreRing } from "./ScoreRing";
import { LabelChip, DirectionChip, SentimentBadge, DataStateBadge, VerificationBadge, EarningsBadge, ContractSourceBadge } from "./Badges";
import { cn } from "@/lib/utils";
import { EXPIRATION_BUCKET_LABEL, expirationBucketFor, hasCostMismatch } from "@/lib/optionQualityValidator";

export function TradeCard({
  t,
  compact = false,
  earnings = null,
}: {
  t: TradeCandidate;
  compact?: boolean;
  earnings?: UpcomingEarnings | null;
}) {
  const c = t.contract;
  const [brokerExpiration, setBrokerExpiration] = useState("");
  const expirationOptions = useMemo(() => {
    const exps = new Set<string>([c.expiration]);
    for (const alt of c.alternatives ?? []) {
      void alt;
    }
    return Array.from(exps);
  }, [c.expiration, c.alternatives]);
  const effectiveBrokerExp = brokerExpiration || c.expiration;
  const expirationMismatch = Boolean(effectiveBrokerExp && c.expiration && effectiveBrokerExp !== c.expiration);
  const askCost = c.ask * 100;
  const mid = c.mid ?? (c.bid + c.ask) / 2;
  const midCost = mid * 100;
  return (
    <div
      className="block rounded-xl border border-border bg-card p-4 transition hover:border-foreground/30 hover:bg-card/80"
    >
      <div className="flex items-start gap-3">
        <ScoreRing score={t.finalScore ?? t.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/trade/$ticker" params={{ ticker: t.ticker }} search={{ id: t.id }} className="text-lg font-bold tracking-tight hover:underline">
              {t.ticker}
            </Link>
            <DirectionChip direction={t.direction} />
            {t.originalLabel && t.originalLabel !== t.label ? (
              <span className="inline-flex items-center gap-1 text-[10px]" title="Discipline gate downgraded the base label">
                <span className="text-muted-foreground line-through">Base: {t.originalLabel}</span>
                <span className="text-muted-foreground">→</span>
                <LabelChip label={t.label} />
              </span>
            ) : (
              <LabelChip label={t.label} />
            )}
            <span className="mono text-sm text-muted-foreground">${t.price.toFixed(2)}</span>
            <span className="text-xs text-muted-foreground">· {t.cap}</span>
            <span className="text-xs text-muted-foreground">· {t.setupType}</span>
            <DataStateBadge state={t.liveState ?? (t.isDemo ? "demo" : "live")} />
          </div>
          {/* Score breakdown — Setup / Contract / Risk-Reward / Data Quality / Final */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
            <Pill tone="muted">Setup {t.setupScore ?? t.score}</Pill>
            <Pill tone={(t.contractQualityScore ?? 0) >= 28 ? "bull" : (t.contractQualityScore ?? 0) >= 18 ? "info" : "bear"}>
              Contract {t.contractQualityScore ?? 0}/35
            </Pill>
            <Pill tone={(t.validationPenalty ?? 0) < 0 ? "bear" : "muted"}>
              Penalty {(t.validationPenalty ?? 0) <= 0 ? t.validationPenalty ?? 0 : `+${t.validationPenalty}`}
            </Pill>
            <Pill tone={(t.finalScore ?? t.score) >= 85 ? "bull" : (t.finalScore ?? t.score) === 0 ? "bear" : "info"}>
              Final {t.finalScore ?? t.score}
            </Pill>
            {t.dteBucketLabel && (
              <Pill tone="muted">Bucket: {t.dteBucketLabel}</Pill>
            )}
            {t.sectionRouted && (
              <Pill tone="muted">Routed: {t.sectionRouted}</Pill>
            )}
          </div>
          {t.contractQualityParts && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
              <span>Δ {t.contractQualityParts.delta}/8</span>
              <span>· Θ {t.contractQualityParts.theta}/7</span>
              <span>· IV {t.contractQualityParts.iv}/6</span>
              <span>· Spread {t.contractQualityParts.spread}/6</span>
              <span>· OI {t.contractQualityParts.oi}/4</span>
              <span>· Vol {t.contractQualityParts.volume}/4</span>
              {t.contractTier && t.contractTier !== "buyNowEligible" && (
                <Pill tone={t.contractTier === "avoid" ? "bear" : "info"}>Tier: {t.contractTier}</Pill>
              )}
            </div>
          )}
          {t.contractBlockers && t.contractBlockers.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
              {t.contractBlockers.map((b, i) => <Pill key={i} tone="bear">{b}</Pill>)}
            </div>
          )}
          {t.contractDowngrades && t.contractDowngrades.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
              {t.contractDowngrades.map((b, i) => <Pill key={i} tone="info">{b}</Pill>)}
            </div>
          )}
          {t.validationReason && (
            <p className={cn(
              "mt-1 text-xs",
              t.validationOk === false ? "text-[var(--color-bear)]" : "text-muted-foreground",
            )}>
              {t.validationReason}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{t.trend}</p>
          <p className="mt-1 text-xs">
            <span className="text-muted-foreground">Why {t.direction === "CALL" ? "bullish" : "bearish"}:</span>{" "}
            <span className="text-foreground">{t.sectorConfirmation}</span>
          </p>
          {!compact && (() => {
            // Only show concrete strike/expiration/Greeks when the row came
            // from a real option-chain. Mock-seed and mock-rescaled rows
            // would otherwise display strikes & expirations that don't
            // exist on the broker (e.g. a 3rd-Friday monthly when the real
            // chain has weeklies). Show "—" with a tooltip instead.
            const isLive = c.source === "chain";
            const dash = "—";
            const title = isLive ? undefined : "Awaiting live option chain — broker has different listed strikes/expirations.";
            return (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4" title={title}>
                <Stat k="Strike" v={isLive ? `$${c.strike}` : dash} />
                <Stat k="Exp" v={isLive ? c.expiration : dash} />
                <Stat k="Ask" v={isLive ? `$${c.ask.toFixed(2)}` : dash} />
                <Stat k="Ask cost" v={isLive ? `$${askCost.toFixed(0)}` : dash} />
                <Stat k="Mid" v={isLive ? `$${mid.toFixed(2)}` : dash} />
                <Stat k="Mid cost" v={isLive ? `$${midCost.toFixed(0)}` : dash} />
                <Stat k="Basis" v={isLive ? basisLabel(c.priceBasis) : dash} />
                <Stat k="Δ" v={isLive ? c.delta.toFixed(2) : dash} />
                <Stat k="IV" v={isLive ? `${(c.iv * 100).toFixed(0)}%` : dash} />
                <Stat k="θ burn" v={isLive ? `${(c.thetaBurnPct * 100).toFixed(1)}%/d` : dash} />
                <Stat k="Spread" v={isLive ? `${(c.spreadPct * 100).toFixed(0)}%` : dash} />
                <Stat k="DTE" v={isLive ? `${c.dte}d` : dash} />
                <Stat k="OI" v={isLive ? c.openInterest.toLocaleString() : dash} />
                <Stat k="Vol" v={isLive ? c.volume.toLocaleString() : dash} />
                <Stat k="BE move" v={isLive ? `${(c.breakevenMovePct * 100).toFixed(1)}%` : dash} />
              </div>
            );
          })()}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            {t.entryMode && <Pill tone="muted">Entry: {t.entryMode}</Pill>}
            <Pill tone={t.selectedContractFitsEntryMode === false ? "bear" : "bull"}>Fits entry: {t.selectedContractFitsEntryMode === false ? "No" : "Yes"}</Pill>
            <Pill tone={t.buyNowEligible ? "bull" : "bear"}>Buy Now eligible: {t.buyNowEligible ? "Yes" : "No"}</Pill>
            <Pill tone="muted">{EXPIRATION_BUCKET_LABEL[expirationBucketFor(c.dte)]}</Pill>
            {c.source === "chain" && (
              <Pill tone="info">
                Cost status: {c.costValidationStatus ?? "unknown"}
              </Pill>
            )}
            {c.source === "chain" && hasCostMismatch(c) && (
              <Pill tone="bear">⚠ Cost mismatch (ask×100 ≠ ${c.cost.toFixed(0)})</Pill>
            )}
          </div>
          {c.source === "chain" && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
              <span className="text-muted-foreground">App exp: <span className="mono text-foreground">{c.expiration}</span> · DTE {c.dte}</span>
              <label className="flex items-center gap-1 text-muted-foreground">
                Broker exp
                <select value={effectiveBrokerExp} onChange={(e) => setBrokerExpiration(e.target.value)} className="rounded border border-border bg-background px-1 py-0.5 text-foreground">
                  {expirationOptions.map((exp) => <option key={exp} value={exp}>{exp}</option>)}
                  <option value="2026-06-05">2026-06-05</option>
                  <option value="2026-06-12">2026-06-12</option>
                </select>
              </label>
              {expirationMismatch && <Pill tone="bear">Not comparable — different expiration selected.</Pill>}
            </div>
          )}
          {t.buyNowBlockers && t.buyNowBlockers.length > 0 && (
            <div className="mt-2 text-[10px] text-[var(--color-bear)]">
              Buy Now blockers: {t.buyNowBlockers.join(" · ")}
            </div>
          )}
          {t.scorePenalties && t.scorePenalties.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[10px] text-[var(--color-watch)]">
              {t.scorePenalties.map((p, i) => (
                <li key={i}>⚠ {p.reason} ({p.delta})</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ContractSourceBadge c={c} />
            <SentimentBadge s={t.redditSentiment} />
            <VerificationBadge v={c.verification} />
            {earnings ? (
              <EarningsBadge
                daysUntil={earnings.daysUntil}
                date={earnings.date}
                hour={earnings.hour}
                withinDte={earnings.daysUntil <= c.dte}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("mono font-medium", accent)}>{v}</span>
    </div>
  );
}

function basisLabel(basis: TradeCandidate["contract"]["priceBasis"]): string {
  if (basis === "ask") return "Ask";
  if (basis === "mid") return "Mid Estimate";
  if (basis === "last") return "Last";
  return "Unknown";
}

function Pill({ tone, children }: { tone: "muted" | "info" | "bear" | "bull"; children: React.ReactNode }) {
  const cls = tone === "bear"
    ? "border-[var(--color-bear)]/40 bg-[var(--color-bear)]/10 text-[var(--color-bear)]"
    : tone === "bull"
      ? "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
      : tone === "info"
        ? "border-border bg-muted/40 text-foreground"
        : "border-border text-muted-foreground";
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 font-medium", cls)}>{children}</span>;
}

