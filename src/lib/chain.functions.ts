import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  fetchPublicOptionChain,
  selectContractFromChain,
  publicConfigured,
  isPublicRateLimited,
  getPublicCooldownStatus,
  type PublicOptionContract,
} from "./publicCom.server";
import { massiveConfigured } from "./massive.server";
import { fetchMassiveOptionChain, type MassiveOptionContract } from "./massiveOptions.server";
import {
  scoreOptionQuality,
  scoreRiskReward,
  calculateThetaBurn,
  calculateBreakevenMove,
} from "./scoringEngine";
import type { OptionContract, Direction } from "./types";
import { costValidationStatus, validateContract, expirationBucketFor } from "./optionQualityValidator";
import { marketListedVerification, verifyContract } from "./contractVerify.server";
import { getScannerSettings } from "./scannerQueue";
import { chainPickKey } from "./chainKeys";
import { createScanRun, persistScanRun } from "./scanRunLogger.server";
import { buildExpirationMeta, type ExpirationMeta } from "./expirationMeta";
import {
  validateOptionContract,
  findNearbyCompleteStrike,
  type OptionContractData,
  type DataQualityResult,
} from "./optionDataQuality";
import { repairContract } from "./optionRepair.server";
import { searchBetterContract } from "./contractRepair";

export interface EnrichedContract {
  ticker: string;
  direction: Direction;
  underlyingPrice: number;
  contract: OptionContract;
  expectedMovePct: number;
  optionScore: number;     // 0-35
  riskScore: number;       // 0-15
  scoreDelta: number;      // optionScore + riskScore (chain-driven portion)
  source: "public" | "massive";
  verification?: import("./contractVerify.types").ContractVerification;
}

export type { ExpirationMeta } from "./expirationMeta";

export interface ChainDebug {
  ticker: string;
  direction: Direction;
  source: "public" | "massive" | "none";
  cached: boolean;
  fetchedAt: number;
  endpoint: string;
  /** All expirations returned by the chain endpoint, sorted by Date asc. */
  availableExpirations: ExpirationMeta[];
  /** Expiration the user picked in the UI (if any). */
  userSelectedExpiration: string | null;
  /** Expiration the scanner actually selected for the winning contract. */
  scannerSelectedExpiration: string | null;
  scannerSelectedDte: number | null;
  scannerSelectedBucket: import("./types").ExpirationBucket | null;
  selectedReason: "user-filter" | "best-score" | "default-bucket" | "none";
  /** True iff a hard `expiration === selectedExpiration` filter was applied. */
  selectionFilterApplied: boolean;
  trace: import("./publicCom.server").ContractTraceRow[];
  errorReason?: string;
}

export interface EnrichmentResult {
  enriched: Record<string, EnrichedContract | null>;
  /** Per-pick chain-selection debug. Optional for backwards-compat with older callers. */
  debug?: Record<string, ChainDebug>;
  live: boolean;
  rateLimited: boolean;
  retryInMs: number;        // 0 when not rate-limited
  retryAt: number | null;   // epoch ms
  message: string | null;   // user-friendly status copy
  error?: string;
  scanId?: string;          // set when this run was logged to scan_runs
}

const Input = z.object({
  picks: z
    .array(
      z.object({
        ticker: z.string().min(1).max(10),
        direction: z.enum(["CALL", "PUT"]),
        isLeaps: z.boolean().optional(),
        isYolo: z.boolean().optional(),
          entryMode: z.enum(["Support Reclaim", "Breakout", "Retest", "Momentum", "Lotto"]).optional(),
          targetStrike: z.number().positive().optional(),
          /** Hard expiration filter set by user in card UI (YYYY-MM-DD). */
          selectedExpiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .min(1)
    .max(25),
});


function toOptionContract(
  c: PublicOptionContract,
  underlyingPrice: number,
): OptionContract {
  const mid = c.mid;
  const cost = mid * 100;
  // Only compute breakeven-move% when underlying is real.
  const breakevenMovePct =
    underlyingPrice > 0
      ? calculateBreakevenMove(c.type, c.breakeven, underlyingPrice)
      : 0;
  // Theta-burn requires real theta AND real ask. If either is missing,
  // leave at 0 and let the validator flag it.
  const askOk = Number.isFinite(c.ask) && c.ask > 0;
  const thetaOk = Number.isFinite(c.theta);
  const thetaBurnPct = askOk && thetaOk ? calculateThetaBurn(c.theta, c.ask) : 0;

  const base: OptionContract = {
    expiration: c.expiration,
    strike: c.strike,
    ask: c.ask,
    bid: c.bid,
    cost,
    mid,
    priceBasis: "mid",
    iv: c.iv,
    delta: c.delta,
    theta: c.theta,
    thetaBurnPct,
    gamma: c.gamma,
    vega: c.vega,
    volume: c.volume,
    openInterest: c.openInterest,
    spreadPct: c.spreadPct,
    dte: c.dte,
    breakeven: c.breakeven,
    breakevenMovePct,
    source: "chain",
  };
  base.costValidationStatus = costValidationStatus(base);
  const v = validateContract(base);
  const missing = [...v.missingFields];
  let bcr = v.brokerConfirmRequired;

  // Sanity: a "verified real contract" must have a strike within a sane band
  // of the live underlying. LEAPS get a wider band than short-term.
  // Without this guard, a stale or mis-selected chain row can flash the
  // green "Verified Real Contract" badge even though the strike is nowhere
  // near tradable. Band: ±35% short-term, ±60% LEAPS.
  if (underlyingPrice > 0 && Number.isFinite(c.strike) && c.strike > 0) {
    const band = c.dte > 180 ? 0.6 : 0.35;
    const drift = Math.abs(c.strike - underlyingPrice) / underlyingPrice;
    if (drift > band) {
      missing.push("strike-out-of-range");
      bcr = true;
    }
  }
  // Sanity: bid/ask must be finite positives (not zero-zero) to count as
  // a quoted contract. Zero quotes mean illiquid / no market.
  if (!(Number.isFinite(c.bid) && Number.isFinite(c.ask) && c.ask > 0)) {
    if (!missing.includes("bid") && !missing.includes("ask")) missing.push("no-quote");
    bcr = true;
  }
  return {
    ...base,
    brokerConfirmRequired: bcr,
    missingFields: missing,
  };
}

export const enrichWithPublicChain = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<EnrichmentResult> => {
    const out: Record<string, EnrichedContract | null> = {};
    const debug: Record<string, ChainDebug> = {};
    const baseStatus = getPublicCooldownStatus();
    const canUsePublic = publicConfigured() && !baseStatus.rateLimited;
    const canUseMassive = massiveConfigured();
    if (!publicConfigured() && !canUseMassive) {
      return {
        enriched: out, debug, live: false,
        rateLimited: false, retryInMs: 0, retryAt: null,
        message: "No option-chain provider is configured — showing demo data.",
        error: "not-configured",
      };
    }
    if (baseStatus.rateLimited && !canUseMassive) {
      return {
        enriched: out, debug, live: false,
        rateLimited: true,
        retryInMs: baseStatus.remainingMs,
        retryAt: baseStatus.retryAt,
        message: `Public.com is rate-limiting requests. Retrying in ${Math.ceil(baseStatus.remainingMs / 1000)}s.`,
      };
    }

    let hitRateLimit = false;
    const settings = getScannerSettings();
    const limitedPicks = data.picks.slice(0, settings.maxTickersPerScan);
    const run = createScanRun(limitedPicks);

    const tasks = limitedPicks.map(async (p) => {
      const ticker = p.ticker.trim().toUpperCase();
      const outKey = chainPickKey(ticker, p.direction, { isLeaps: p.isLeaps, isYolo: p.isYolo, entryMode: p.entryMode, selectedExpiration: p.selectedExpiration });
      try {
        // PRIMARY: Massive snapshot. FALLBACK: Public.com chain.
        const massiveChain = canUseMassive
          ? await fetchMassiveOptionChain(ticker, p.direction, { isLeaps: p.isLeaps, isYolo: p.isYolo }).catch((e) => {
              console.warn(`[chain] massive ${ticker} failed`, e);
              run.filterDecisions[outKey] = { stage: "fetch", provider: "massive", reason: "fetch-failed", message: e instanceof Error ? e.message : String(e) };
              return null;
            })
          : null;
        let publicChain: Awaited<ReturnType<typeof fetchPublicOptionChain>> | null = null;
        if (!massiveChain && canUsePublic) {
          try {
            publicChain = await fetchPublicOptionChain(ticker);
          } catch (e) {
            if (isPublicRateLimited(e)) hitRateLimit = true;
            else console.warn(`[chain] public ${ticker} failed`, e);
            run.filterDecisions[outKey] = { stage: "fetch", provider: "public", reason: isPublicRateLimited(e) ? "rate-limited" : "fetch-failed", message: e instanceof Error ? e.message : String(e) };
          }
        }
        const chain = massiveChain ?? publicChain;
        const source: "public" | "massive" | "none" = massiveChain ? "massive" : publicChain ? "public" : "none";
        // Build availableExpirations from the raw chain (sorted by Date asc).
        const availableExpirations = buildExpirationMeta(chain?.contracts ?? []);
        const baseDebug: ChainDebug = {
          ticker, direction: p.direction,
          source,
          cached: Boolean((chain as { cached?: boolean } | null)?.cached),
          fetchedAt: Number((chain as { fetchedAt?: number } | null)?.fetchedAt ?? Date.now()),
          endpoint: String((chain as { endpoint?: string } | null)?.endpoint ?? (source === "massive" ? "massive snapshot" : source === "public" ? "public option-chain" : "none")),
          availableExpirations,
          userSelectedExpiration: p.selectedExpiration ?? null,
          scannerSelectedExpiration: null,
          scannerSelectedDte: null,
          scannerSelectedBucket: null,
          selectedReason: "none",
          selectionFilterApplied: !!p.selectedExpiration,
          trace: [],
        };
        run.rawResponses[outKey] = {
          provider: source === "none" ? "public" : source,
          underlyingPrice: chain?.underlyingPrice ?? null,
          contractCount: chain?.contracts?.length ?? 0,
          contractsSample: (chain?.contracts ?? []).slice(0, 25),
        };
        if (!chain) {
          out[outKey] = null;
          debug[outKey] = { ...baseDebug, errorReason: "no-chain" };
          run.filterDecisions[outKey] = run.filterDecisions[outKey] ?? { stage: "fetch", reason: "no-chain" };
          return;
        }
        const sel = selectContractFromChain(chain, {
          direction: p.direction,
          isLeaps: p.isLeaps,
          isYolo: p.isYolo,
          entryMode: p.entryMode,
          targetStrike: p.targetStrike,
          selectedExpiration: p.selectedExpiration,
        });
        const picked = sel.contract;
        if (!picked || chain.underlyingPrice <= 0) {
          out[outKey] = null;
          debug[outKey] = {
            ...baseDebug,
            selectedReason: sel.reason,
            selectionFilterApplied: sel.selectionFilterApplied,
            trace: sel.trace,
            errorReason: !picked
              ? p.selectedExpiration
                ? `No valid contracts for selected expiration ${p.selectedExpiration}.`
                : "no-contract-passed-filter"
              : "underlying-price-invalid",
          };
          run.filterDecisions[outKey] = { stage: "select", reason: !picked ? "no-contract-passed-filter" : "underlying-price-invalid" };
          return;
        }
        const contract = toOptionContract(picked, chain.underlyingPrice);
        // Attach OCC symbol for repair lookups (massive snapshot only).
        if ((picked as Partial<MassiveOptionContract>).occSymbol) {
          contract.occSymbol = (picked as MassiveOptionContract).occSymbol;
        }

        // ---- Massive Options Data Quality ----
        // Validate, repair if missing critical fields, then re-validate.
        let dq: DataQualityResult = validateOptionContract(toDataQuality(contract, ticker));
        if (!dq.isValidForBuyNow && contract.occSymbol && source === "massive") {
          try {
            const { contract: repaired, endpoint } = await repairContract(toDataQuality(contract, ticker));
            mergeRepairedIntoContract(contract, repaired);
            const nearby = findNearbyCompleteStrike(
              toDataQuality(contract, ticker),
              (chain.contracts as MassiveOptionContract[]).map((mc) => toDataQualityFromMassive(mc, ticker)),
            );
            dq = validateOptionContract(toDataQuality(contract, ticker), {
              repairAttempted: true,
              repairSucceeded: endpoint != null && (!!contract.bid && !!contract.ask),
              repairEndpoint: endpoint,
              nearbyComplete: nearby,
            });
          } catch (e) {
            console.warn(`[chain] dq repair failed for ${ticker}`, e);
          }
        } else if (!dq.isValidForBuyNow) {
          // No repair endpoint available — still try to suggest a nearby strike.
          const nearby = findNearbyCompleteStrike(
            toDataQuality(contract, ticker),
            (chain.contracts as Array<MassiveOptionContract | PublicOptionContract>).map((mc) => toDataQualityFromAny(mc, ticker)),
          );
          if (nearby) {
            dq = validateOptionContract(toDataQuality(contract, ticker), { nearbyComplete: nearby });
          }
        }
        contract.dataQuality = dq;
        // Reflect the data-quality verdict on the broker-confirm flag so the
        // existing badge / discipline-gate code stays consistent.
        if (dq.brokerConfirmationRequired) contract.brokerConfirmRequired = true;
        for (const f of dq.missingFields) {
          if (!(contract.missingFields ?? []).includes(f)) {
            contract.missingFields = [...(contract.missingFields ?? []), f];
          }
        }

        // ---- Contract Repair / Better-Strike Search ----
        // Before rejecting the pick, look for a better contract in the chain
        // that fits the active entry mode and clears OI/volume/spread floors.
        try {
          const entryMode = p.entryMode ?? "Momentum";
          const fullChainData = (chain.contracts as Array<MassiveOptionContract | PublicOptionContract>)
            .map((mc) => toDataQualityFromAny(mc, ticker));
          const repairReport = searchBetterContract({
            original: toDataQuality(contract, ticker),
            chain: fullChainData,
            ctx: {
              direction: p.direction,
              entryMode,
              underlyingPrice: chain.underlyingPrice,
              breakoutTrigger: 0,
            },
          });
          if (repairReport.replacementContractFound && repairReport.replacementContract) {
            const repl = repairReport.replacementContract;
            const replRaw = (chain.contracts as Array<MassiveOptionContract | PublicOptionContract>).find((c) => {
              const occ = (c as Partial<MassiveOptionContract>).occSymbol;
              if (occ && occ === repl.optionTicker) return true;
              return c.expiration === repl.expiration && c.strike === repl.strike && c.type === repl.type;
            });
            if (replRaw) {
              const swapped = toOptionContract(replRaw as PublicOptionContract, chain.underlyingPrice);
              if ((replRaw as Partial<MassiveOptionContract>).occSymbol) {
                swapped.occSymbol = (replRaw as MassiveOptionContract).occSymbol;
              }
              swapped.dataQuality = validateOptionContract(toDataQuality(swapped, ticker));
              swapped.contractRepair = repairReport;
              Object.assign(contract, swapped);
            } else {
              contract.contractRepair = repairReport;
            }
          } else {
            contract.contractRepair = repairReport;
          }
        } catch (e) {
          console.warn(`[chain] contract repair search failed for ${ticker}`, e);
        }

        // ---- Contract Classification (moneyness / style / explanation) ----
        try {
          const { classifyContract } = await import("./contractClassification");
          contract.classification = classifyContract({
            direction: p.direction,
            strike: contract.strike,
            underlyingPrice: chain.underlyingPrice,
            breakeven: contract.breakeven,
            delta: contract.delta,
            entryMode: p.entryMode ?? "Momentum",
            isLeaps: p.isLeaps,
            isYolo: p.isYolo,
            quality: {
              spreadPct: contract.spreadPct,
              openInterest: contract.openInterest,
              volume: contract.volume,
              iv: contract.iv,
              bid: contract.bid,
              ask: contract.ask,
              dte: contract.dte,
              premium: (contract.mid ?? contract.ask) * 100,
            },
            premium: (contract.mid ?? contract.ask) * 100,
            dte: contract.dte,
          });
        } catch (e) {
          console.warn(`[chain] classification failed for ${ticker}`, e);
        }

        const optionScore = scoreOptionQuality({ contract, isLeaps: p.isLeaps, isYolo: p.isYolo });
        const riskScore = scoreRiskReward({
          breakevenMovePct: contract.breakevenMovePct,
          entryNearSupport: true,
          resistanceRealistic: true,
          hasInvalidation: true,
          expectedMovePct: picked.expectedMovePct,
        });
        const verification = source === "massive"
          ? marketListedVerification(contract)
          : await verifyContract(ticker, p.direction, contract);
        const enriched: EnrichedContract = {
          ticker, direction: p.direction,
          underlyingPrice: chain.underlyingPrice,
          contract, expectedMovePct: picked.expectedMovePct,
          optionScore, riskScore,
          scoreDelta: optionScore + riskScore,
          source: source === "none" ? "public" : source,
          verification,
        };
        out[outKey] = enriched;
        debug[outKey] = {
          ...baseDebug,
          scannerSelectedExpiration: picked.expiration,
          scannerSelectedDte: picked.dte,
          scannerSelectedBucket: expirationBucketFor(picked.dte),
          selectedReason: sel.reason,
          selectionFilterApplied: sel.selectionFilterApplied,
          trace: sel.trace,
        };
        run.filterDecisions[outKey] = { stage: "passed", brokerConfirmRequired: contract.brokerConfirmRequired ?? false, missingFields: contract.missingFields ?? [] };
        run.finalPicks[outKey] = enriched;
      } catch (e) {
        if (isPublicRateLimited(e)) hitRateLimit = true;
        else console.warn(`[chain] ${p.ticker} failed`, e);
        out[outKey] = null;
        debug[outKey] = debug[outKey] ?? {
          ticker, direction: p.direction,
          source: "none", cached: false, fetchedAt: Date.now(),
          endpoint: "none",
          availableExpirations: [],
          userSelectedExpiration: p.selectedExpiration ?? null,
          scannerSelectedExpiration: null, scannerSelectedDte: null, scannerSelectedBucket: null,
          selectedReason: "none", selectionFilterApplied: !!p.selectedExpiration,
          trace: [],
          errorReason: e instanceof Error ? e.message : String(e),
        };
        run.filterDecisions[outKey] = { stage: "error", reason: e instanceof Error ? e.message : String(e) };
      }
    });

    await Promise.all(tasks);
    const live = Object.values(out).some((v) => v !== null);
    const liveCount = Object.values(out).filter((v) => v !== null).length;
    const after = getPublicCooldownStatus();
    const rateLimited = hitRateLimit || after.rateLimited;
    void persistScanRun(run, { rateLimited, liveCount });
    return {
      enriched: out, debug, live,
      rateLimited,
      retryInMs: after.remainingMs,
      retryAt: after.retryAt,
      scanId: run.scanId,
      message: rateLimited
        ? `Public.com rate-limited — using demo data, retry in ${Math.ceil(after.remainingMs / 1000)}s.`
        : live ? null : "Public.com returned no chain data — showing demo.",
    };
  });

export { buildExpirationMeta } from "./expirationMeta";

// ---- Adapters between OptionContract and OptionContractData ----

function nz(n: number | undefined | null): number | null {
  return n != null && Number.isFinite(n) && n !== 0 ? n : null;
}

function toDataQuality(c: OptionContract, ticker: string): OptionContractData {
  return {
    optionTicker: c.occSymbol ?? `${ticker}-${c.expiration}-${c.strike}`,
    underlyingTicker: ticker,
    expirationDate: c.expiration,
    strikePrice: c.strike,
    contractType: c.delta >= 0 ? "CALL" : "PUT",
    bid: nz(c.bid),
    ask: nz(c.ask),
    latestTrade: nz(c.last ?? null),
    delta: Number.isFinite(c.delta) && c.delta !== 0 ? c.delta : null,
    gamma: Number.isFinite(c.gamma) && c.gamma !== 0 ? c.gamma : null,
    theta: Number.isFinite(c.theta) && c.theta !== 0 ? c.theta : null,
    vega: Number.isFinite(c.vega) && c.vega !== 0 ? c.vega : null,
    impliedVolatility: nz(c.iv),
    volume: Number.isFinite(c.volume) ? c.volume : null,
    openInterest: Number.isFinite(c.openInterest) ? c.openInterest : null,
    spreadPct: Number.isFinite(c.spreadPct) ? c.spreadPct : null,
    dte: c.dte,
    breakeven: nz(c.breakeven),
    underlyingPrice: null,
  };
}

function toDataQualityFromMassive(m: MassiveOptionContract, ticker: string): OptionContractData {
  return {
    optionTicker: m.occSymbol,
    underlyingTicker: ticker,
    expirationDate: m.expiration,
    strikePrice: m.strike,
    contractType: m.type,
    bid: nz(m.bid),
    ask: nz(m.ask),
    latestTrade: null,
    delta: nz(m.delta),
    gamma: nz(m.gamma),
    theta: nz(m.theta),
    vega: nz(m.vega),
    impliedVolatility: nz(m.iv),
    volume: m.volume,
    openInterest: m.openInterest,
    spreadPct: m.spreadPct,
    dte: m.dte,
    breakeven: nz(m.breakeven),
    underlyingPrice: null,
  };
}

function toDataQualityFromAny(
  m: MassiveOptionContract | PublicOptionContract,
  ticker: string,
): OptionContractData {
  if ("occSymbol" in m) return toDataQualityFromMassive(m as MassiveOptionContract, ticker);
  const p = m as PublicOptionContract;
  return {
    optionTicker: `${ticker}-${p.expiration}-${p.type}-${p.strike}`,
    underlyingTicker: ticker,
    expirationDate: p.expiration,
    strikePrice: p.strike,
    contractType: p.type,
    bid: nz(p.bid),
    ask: nz(p.ask),
    latestTrade: null,
    delta: nz(p.delta),
    gamma: nz(p.gamma),
    theta: nz(p.theta),
    vega: nz(p.vega),
    impliedVolatility: nz(p.iv),
    volume: p.volume,
    openInterest: p.openInterest,
    spreadPct: p.spreadPct,
    dte: p.dte,
    breakeven: nz(p.breakeven),
    underlyingPrice: null,
  };
}

function mergeRepairedIntoContract(target: OptionContract, repaired: OptionContractData): void {
  if (repaired.bid != null) target.bid = repaired.bid;
  if (repaired.ask != null) target.ask = repaired.ask;
  if (repaired.delta != null) target.delta = repaired.delta;
  if (repaired.gamma != null) target.gamma = repaired.gamma;
  if (repaired.theta != null) target.theta = repaired.theta;
  if (repaired.vega != null) target.vega = repaired.vega;
  if (repaired.impliedVolatility != null) target.iv = repaired.impliedVolatility;
  if (repaired.volume != null) target.volume = repaired.volume;
  if (repaired.openInterest != null) target.openInterest = repaired.openInterest;
  if (repaired.spreadPct != null) target.spreadPct = repaired.spreadPct;
  if (repaired.breakeven != null) target.breakeven = repaired.breakeven;
}

