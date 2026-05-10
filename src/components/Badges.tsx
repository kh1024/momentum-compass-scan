import type { Label, Direction, Sentiment, OptionContract } from "@/lib/types";
import type { ContractVerification } from "@/lib/contractVerify.types";
import { cn } from "@/lib/utils";
import { displayLabelFor, DISPLAY_LABEL_STYLES } from "@/lib/uiVocabulary";

export function LabelChip({ label, className }: { label: Label; className?: string }) {
  const display = displayLabelFor(label);
  if (display === "Hidden") return null;
  const styles = DISPLAY_LABEL_STYLES[display];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide", styles.chip, className)}>
      {display}
    </span>
  );
}

export function DirectionChip({ direction }: { direction: Direction }) {
  const isCall = direction === "CALL";
  return (
    <span className={cn(
      "inline-flex items-center rounded px-2 py-0.5 text-xs font-bold tracking-wide",
      isCall ? "bg-[var(--color-bull)]/15 text-[var(--color-bull)]" : "bg-[var(--color-bear)]/15 text-[var(--color-bear)]"
    )}>
      {direction}
    </span>
  );
}

export function SentimentBadge({ s }: { s: Sentiment }) {
  if (s === "None") return null;
  const map: Record<Sentiment, string> = {
    Bullish: "text-[var(--color-bull)]",
    Bearish: "text-[var(--color-bear)]",
    Mixed: "text-muted-foreground",
    "Hype-only": "text-[var(--color-watch)]",
    None: "",
  };
  return <span className={cn("text-xs font-medium", map[s])}>Reddit: {s}</span>;
}

export function DemoBadge() {
  // Production: never surface "Demo" wording to users. Show a neutral
  // "Last close" indicator instead — the underlying may be stale but the
  // app is fully functional.
  return (
    <span
      title="Showing last-known close. Will refresh on next live poll."
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-500"
    >
      Last Close
    </span>
  );
}

export function LiveDataBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-bull)]">
      Live Data
    </span>
  );
}

export function StaleBadge() {
  return (
    <span
      title="Showing last-known live data. Provider was briefly unreachable or rate-limited; will refresh automatically."
      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-watch)]/40 bg-[var(--color-watch)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-watch)]"
    >
      Delayed
    </span>
  );
}

export function DataStateBadge({ state }: { state?: "live" | "stale" | "demo" }) {
  if (!state || state === "live") return null; // hide on live to reduce noise on cards
  if (state === "stale") return <StaleBadge />;
  return <DemoBadge />;
}

export function BrokerConfirmBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-[var(--color-watch)]/40 bg-[var(--color-watch)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-watch)]">
      Confirm in Broker
    </span>
  );
}


/**
 * Cross-source verification badge. Shows:
 *  - "Verified 2/2"  → both sources agree on every checked field
 *  - "Unverified"    → secondary unavailable (e.g. Finnhub plan lacks chain)
 *  - "Disputed: …"   → secondary returned different numbers
 *  - "No such contract" → exp/strike doesn't exist on secondary
 */
export function VerificationBadge({ v }: { v?: ContractVerification }) {
  if (!v) {
    return (
      <span
        title="No second source checked yet"
        className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
      >
        Unverified
      </span>
    );
  }
  if (!v.secondaryAvailable) {
    return (
      <span
        title="Finnhub option-chain unavailable on current plan — couldn't cross-check."
        className="inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
      >
        Unverified
      </span>
    );
  }
  if (!v.contractExists) {
    return (
      <span
        title="Finnhub has no contract at this expiration/strike."
        className="inline-flex items-center gap-1 rounded border border-[var(--color-bear)]/40 bg-[var(--color-bear)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-bear)]"
      >
        No such contract
      </span>
    );
  }
  if (v.allMatch) {
    return (
      <span
        title="Public.com + Finnhub agree on every field."
        className="inline-flex items-center gap-1 rounded border border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-bull)]"
      >
        Verified 2/2
      </span>
    );
  }
  return (
    <span
      title={`Sources disagree on: ${v.disputed.join(", ")}`}
      className="inline-flex items-center gap-1 rounded border border-[var(--color-watch)]/40 bg-[var(--color-watch)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-watch)]"
    >
      Disputed: {v.disputed.slice(0, 3).join(", ")}
      {v.disputed.length > 3 ? "…" : ""}
    </span>
  );
}

export function EarningsBadge({
  daysUntil,
  date,
  hour,
  withinDte,
}: {
  daysUntil: number;
  date: string;
  hour?: string;
  /** True when earnings fall on or before the contract's expiration. */
  withinDte: boolean;
}) {
  const tone = withinDte
    ? "border-[var(--color-bear)]/50 bg-[var(--color-bear)]/15 text-[var(--color-bear)]"
    : "border-[var(--color-watch)]/40 bg-[var(--color-watch)]/10 text-[var(--color-watch)]";
  const label = daysUntil <= 0
    ? "Earnings today"
    : daysUntil === 1
      ? "Earnings tomorrow"
      : `Earnings in ${daysUntil}d`;
  const hourLabel = hour === "bmo" ? "before open" : hour === "amc" ? "after close" : hour === "dmh" ? "during market" : "";
  return (
    <span
      title={`Reports ${date}${hourLabel ? ` (${hourLabel})` : ""}${withinDte ? " — falls inside your DTE window" : ""}`}
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}
    >
      ⚠ {label}
      {withinDte ? " · in DTE" : ""}
    </span>
  );
}

/**
 * Badge that surfaces whether the option contract is a real, verified chain
 * contract — or a synthetic / unverified one that should not be traded
 * without manual broker confirmation.
 */
export function ContractSourceBadge({ c }: { c: OptionContract }) {
  const source = c.source ?? "mock-seed";
  const missing = c.missingFields ?? [];
  const bcr = c.brokerConfirmRequired ?? source !== "chain";

  if (source === "mock-rescaled" || source === "mock-seed") {
    return (
      <span
        title="This strike was not pulled from the real options chain. Do NOT trade — wait for live chain data or verify in your broker."
        className="inline-flex items-center gap-1 rounded border border-[var(--color-bear)]/50 bg-[var(--color-bear)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-bear)]"
      >
        ⚠ Synthetic Strike
      </span>
    );
  }
  if (bcr) {
    return (
      <span
        title={`Missing or invalid: ${missing.join(", ") || "unknown"}. Confirm in broker before trading.`}
        className="inline-flex items-center gap-1 rounded border border-[var(--color-watch)]/50 bg-[var(--color-watch)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-watch)]"
      >
        Broker Confirm Required
      </span>
    );
  }
  return (
    <span
      title="Strike, expiration, bid/ask, and Greeks all came from the live options chain."
      className="inline-flex items-center gap-1 rounded border border-[var(--color-bull)]/50 bg-[var(--color-bull)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-bull)]"
    >
      ✓ Verified Real Contract
    </span>
  );
}

const dqPillBase = "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider";
const tones = {
  good: "border-[var(--color-bull)]/40 bg-[var(--color-bull)]/10 text-[var(--color-bull)]",
  warn: "border-[var(--color-watch)]/40 bg-[var(--color-watch)]/10 text-[var(--color-watch)]",
  bad: "border-[var(--color-bear)]/50 bg-[var(--color-bear)]/15 text-[var(--color-bear)]",
};

export function DataQualityBadges({ dq }: { dq?: import("@/lib/optionDataQuality").DataQualityResult }) {
  if (!dq) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {dq.verified.quote && <span className={cn(dqPillBase, tones.good)}>Quote ✓</span>}
      {dq.verified.greeks && <span className={cn(dqPillBase, tones.good)}>Greeks ✓</span>}
      {dq.verified.iv && <span className={cn(dqPillBase, tones.good)}>IV ✓</span>}
      {dq.verified.volumeOI && <span className={cn(dqPillBase, tones.good)}>Vol/OI ✓</span>}
      {dq.repairAttempted && dq.repairSucceeded && (
        <span className={cn(dqPillBase, tones.warn)} title={`Repaired via ${dq.repairEndpoint}`}>Repaired</span>
      )}
      {dq.finalDataStatus === "broker-confirmation-required" && (
        <span className={cn(dqPillBase, tones.warn)}>Broker Confirm Required</span>
      )}
      {dq.finalDataStatus === "avoid-data-incomplete" && (
        <span className={cn(dqPillBase, tones.bad)}>Avoid · Data Incomplete</span>
      )}
    </span>
  );
}
