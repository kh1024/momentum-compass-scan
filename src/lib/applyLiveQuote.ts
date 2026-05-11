import type { TradeCandidate, Levels } from "./types";
import type { ConsensusQuote } from "./providers.server";
import type { RedditSignal } from "./reddit.functions";
import type { EnrichedContract } from "./chain.functions";
import { hasEverBeenLive, liveStateFor, markLive } from "./liveStateTracker";
import { entryTriggerFromLevels, invalidationFromLevels } from "./supportResistanceEngine";
import { applyEntryAndTrigger, strikeIsBreakoutOnlyBeforeTrigger } from "./entryMode";
import { disciplinePenalties, applyPenalties, scoreContractQuality, assignLabel } from "./scoringEngine";
import { costValidationStatus, dteBucketFor } from "./optionQualityValidator";
import { validateQuote, type QuoteValidation } from "./quoteValidation";

function rebuildPlanStrings(c: TradeCandidate, levels: Levels) {
  return {
    entryTrigger: entryTriggerFromLevels(c.direction, levels),
    invalidation: invalidationFromLevels(c.direction, levels),
  };
}

/**
 * Overlay a live consensus quote onto a mocked candidate.
 * - Replaces underlying price.
 * - Rescales price-denominated fields (levels, targets, contract strike/breakeven)
 *   proportionally so the trade plan tracks the live stock.
 * - Marks the symbol "ever-live" so subsequent empty polls don't flip the
 *   card back to DEMO.
 */
export function applyLiveQuote(
  c: TradeCandidate,
  live: ConsensusQuote | null,
): TradeCandidate {
  // Validate BEFORE we trust the price for anything.
  const validation: QuoteValidation = validateQuote(c.ticker, live);

  // Sticky: if we've ever seen live data for this symbol this session,
  // keep isDemo=false even on an empty / failing poll.
  if (!validation.rankable) {
    // Log rejected quotes so they're traceable in dev mode.
    if (live && validation.status !== "unavailable") {
      // eslint-disable-next-line no-console
      console.warn(`[quote-reject] ${c.ticker}: ${validation.status} — ${validation.reason}`);
    }
    if (hasEverBeenLive(c.ticker)) {
      return {
        ...c,
        isDemo: false,
        liveState: liveStateFor(c.ticker),
        quoteValidation: validation,
      };
    }
    return { ...c, liveState: "demo", quoteValidation: validation };
  }
  markLive(c.ticker, "quote");
  const safePrice = validation.price;
  const consensusSnap = live
    ? {
        sources: live.sources,
        consensusSource: live.consensusSource,
        agreement: live.agreement,
        diffPct: live.diffPct,
        ts: live.ts,
      }
    : undefined;
  const oldPrice = c.price > 0 ? c.price : safePrice;
  const r = safePrice / oldPrice;
  // Skip rescale if delta is trivial — avoids needless churn.
  if (Math.abs(r - 1) < 0.0005) {
    return {
      ...c,
      price: safePrice,
      isDemo: false,
      liveState: liveStateFor(c.ticker),
      quoteValidation: validation,
    };
  }
  const scale = (n: number) => +(n * r).toFixed(2);
  const L = c.levels;
  const k = c.contract;
  const newLevels: Levels = {
    s1: scale(L.s1), s2: scale(L.s2), s3: scale(L.s3),
    r1: scale(L.r1), r2: scale(L.r2), r3: scale(L.r3),
    pivot: scale(L.pivot),
    baseHigh: scale(L.baseHigh),
    baseMid: scale(L.baseMid),
    baseLow: scale(L.baseLow),
    dma20: scale(L.dma20),
    dma50: scale(L.dma50),
    dma200: scale(L.dma200),
    vwap: L.vwap != null ? scale(L.vwap) : L.vwap,
  };
  // CRITICAL: Do NOT rescale contract.strike or contract.breakeven. Strikes
  // are not arbitrary — they are listed values like 217.50 / 220 / 222.50.
  // Rescaling produces synthetic strikes (e.g. $219.39) that do not exist
  // on the real chain. The contract stays in its current state until the
  // chain endpoint replaces it via applyLiveChain.
  return {
    ...c,
    price: safePrice,
    isDemo: false,
    liveState: liveStateFor(c.ticker),
    quoteValidation: validation,
    target1: scale(c.target1),
    target2: scale(c.target2),
    levels: newLevels,
    ...rebuildPlanStrings(c, newLevels),
    contract: {
      ...k,
      // Mark as rescaled-mock so the UI surfaces a "synthetic strike" warning
      // until a real chain contract is loaded.
      source: k.source === "chain" ? "chain" : "mock-rescaled",
      brokerConfirmRequired: k.source === "chain" ? (k.brokerConfirmRequired ?? false) : true,
      missingFields: k.source === "chain" ? (k.missingFields ?? []) : ["live-chain-not-loaded"],
    },
  };
}

/** Overlay live Reddit sentiment + mention trend onto a candidate. */
export function applyRedditSignal(
  c: TradeCandidate,
  sig: RedditSignal | null,
): TradeCandidate {
  if (!sig) return c;
  return {
    ...c,
    redditSentiment: sig.sentiment,
    redditMentionTrend: sig.mentionTrend,
  };
}

/**
 * Overlay a live option-chain enrichment (real strike, expiration, greeks).
 * Recomputes the score's chain-driven portion to match the live contract,
 * and marks the symbol as live (sticky).
 */
export function applyLiveChain(
  c: TradeCandidate,
  live: EnrichedContract | null,
): TradeCandidate {
  if (!live || live.direction !== c.direction) {
    // Even with no fresh chain, preserve sticky state.
    if (hasEverBeenLive(c.ticker)) {
      return { ...c, isDemo: false, liveState: liveStateFor(c.ticker) };
    }
    return c;
  }
  // HARD GATE: refuse to select a contract when the underlying price hasn't
  // been validated. Moneyness, break-even, scoring all depend on price —
  // a bad underlying corrupts everything downstream. Surface as
  // `noQualityContract` so the ticker stays in view as a watchlist idea.
  const qv = c.quoteValidation;
  if (qv && !qv.rankable) {
    // eslint-disable-next-line no-console
    console.warn(
      `[chain-gate] ${c.ticker}: skipping contract — underlying ${qv.status} (${qv.reason})`,
    );
    return {
      ...c,
      noQualityContract: true,
      noQualityReason: `underlying ${qv.status}: ${qv.reason}`,
      isDemo: false,
      liveState: liveStateFor(c.ticker),
    };
  }
  markLive(c.ticker, "chain");
  const baseline = c.score;
  const nonChainEstimate = Math.max(0, baseline - 30);
  const nextScore = Math.max(0, Math.min(100, Math.round(nonChainEstimate + live.scoreDelta)));
  // Price reconciliation: the multi-source consensus quote (applied by
  // applyLiveQuote BEFORE this step) is authoritative because it's verified
  // across providers. The option-chain's `underlying_asset.price` is a single
  // snapshot from one vendor and frequently lags. Prefer the consensus
  // price; only fall back to the chain underlying when we have no quote at
  // all. If both exist and disagree noticeably, log so we can debug.
  const consensusPrice = isFinite(c.price) && c.price > 0 ? c.price : null;
  const chainPrice = isFinite(live.underlyingPrice ?? NaN) && (live.underlyingPrice ?? 0) > 0
    ? (live.underlyingPrice as number)
    : null;
  let resolvedPrice = consensusPrice ?? chainPrice ?? c.price;
  if (consensusPrice && chainPrice) {
    const diffPct = Math.abs(consensusPrice - chainPrice) / consensusPrice;
    if (diffPct > 0.005) {
      // Trust the multi-source consensus, but surface the disagreement.
      // eslint-disable-next-line no-console
      console.warn(
        `[price-reconcile] ${c.ticker}: consensus $${consensusPrice.toFixed(2)} vs chain $${chainPrice.toFixed(2)} (Δ ${(diffPct * 100).toFixed(2)}%) — using consensus.`,
      );
    }
    resolvedPrice = consensusPrice;
  }
  return {
    ...c,
    contract: {
      ...live.contract,
      costValidationStatus: costValidationStatus(live.contract),
      verification: live.verification,
      // Real chain contract — flip out of synthetic state. Validator (run
      // server-side in chain.functions.ts) populates brokerConfirmRequired
      // and missingFields based on real contract data.
      source: "chain",
      brokerConfirmRequired: live.contract.brokerConfirmRequired ?? false,
      missingFields: live.contract.missingFields ?? [],
    },
    price: resolvedPrice,
    score: nextScore,
    isDemo: false,
    liveState: liveStateFor(c.ticker),
  };
}

/**
 * Final discipline pass — recomputes entry mode, trigger status, and
 * applies the penalty model. Should run AFTER applyLiveQuote / applyLiveChain
 * so it sees the freshest price + real-chain strike.
 */
export function finalizeCandidate(c: TradeCandidate): TradeCandidate {
  const isLeaps = c.setupType === "LEAPS";
  const isYolo = c.setupType === "Reddit YOLO";
  const withTrigger = applyEntryAndTrigger(c);
  const contractWithCostStatus = {
    ...withTrigger.contract,
    costValidationStatus: costValidationStatus(withTrigger.contract),
  };
  const checked = { ...withTrigger, contract: contractWithCostStatus };
  const breakoutOnly = strikeIsBreakoutOnlyBeforeTrigger(
    checked.direction,
    checked.contract.strike,
    checked.breakoutTrigger ?? 0,
    checked.triggerStatus ?? "not-active",
  );
  const triggerAmbiguous = checked.finalTriggerUsedForLabel !== "support reclaim"
    && checked.supportReclaimTrigger?.status === "active"
    && checked.triggerStatus !== "active";
  const cq = scoreContractQuality(checked.contract, { isLeaps, isYolo });
  const penalties = disciplinePenalties({
    contract: checked.contract,
    triggerStatus: checked.triggerStatus,
    breakoutStrikeBeforeTrigger: breakoutOnly,
    selectedContractFitsEntryMode: checked.selectedContractFitsEntryMode,
    triggerAmbiguous,
    breakevenMovePct: checked.contract.breakevenMovePct,
    isLeaps, isYolo,
  });
  // Each Contract Quality blocker contributes a -15 penalty so it shows
  // in the validation-penalty list and trims the final score.
  for (const reason of cq.blockers) {
    penalties.push({ reason: `Contract: ${reason}`, delta: -15 });
  }
  const buyNowBlockers = buildBuyNowBlockers(checked, breakoutOnly, triggerAmbiguous);
  for (const b of cq.blockers) buyNowBlockers.push(`contract: ${b}`);
  const setupScore = checked.score;
  const validationPenalty = penalties.reduce((a, b) => a + b.delta, 0);
  const finalScore = applyPenalties(setupScore, penalties);
  // Re-run label gate with contract tier so a bad contract can never be Buy Now.
  const cappedLabel = assignLabel(finalScore, {
    contract: checked.contract,
    above200: true, // upstream gating already applied; defaults are permissive
    above50OrReclaim: true,
    baseLowBroken: false,
    pivotFailed: false,
    redditOnlyThesis: false,
    triggerActive: (checked.triggerStatus ?? "not-active") === "active",
    isYolo, isLeaps,
    contractTier: cq.tier,
  });
  return {
    ...checked,
    score: finalScore,
    label: cappedLabel,
    scorePenalties: penalties,
    setupScore,
    contractQualityScore: cq.score,
    contractQualityParts: cq.parts,
    contractBlockers: cq.blockers,
    contractDowngrades: cq.downgrades,
    contractTier: cq.tier,
    validationPenalty,
    finalScore,
    originalLabel: withTrigger.label,
    buyNowEligible: buyNowBlockers.length === 0 && cq.tier === "buyNowEligible",
    buyNowBlockers: Array.from(new Set(buyNowBlockers)),
  };
}

function buildBuyNowBlockers(c: TradeCandidate, breakoutOnly: boolean, triggerAmbiguous: boolean): string[] {
  const blockers: string[] = [];
  const k = c.contract;
  const missing = k.missingFields ?? [];
  if (k.costValidationStatus === "mismatch") blockers.push("cost mismatch");
  if (k.breakevenMovePct > 0.08) blockers.push("breakeven too high");
  if (c.selectedContractFitsEntryMode === false) blockers.push("selected strike does not match active entry mode");
  if (breakoutOnly) blockers.push("breakout trigger not active");
  if (c.triggerStatus && c.triggerStatus !== "active") blockers.push("trigger status not active");
  if (triggerAmbiguous) blockers.push("trigger status mixed/ambiguous");
  if (k.brokerConfirmRequired || missing.some((f) => /quote|bid|ask/.test(f))) blockers.push("quote not verified");
  if (missing.some((f) => /delta|theta|iv/.test(f))) blockers.push("Greeks not verified");
  if (k.spreadPct > 0.15) blockers.push("spread too wide");
  if (["excluded", "excluded-short-term", "leaps-only"].includes(dteBucketFor(k.dte)) && c.setupType !== "LEAPS") blockers.push("DTE bucket invalid");
  if (c.expirationComparison?.status === "not-comparable") blockers.push("expiration comparison mismatch");
  return Array.from(new Set(blockers));
}
