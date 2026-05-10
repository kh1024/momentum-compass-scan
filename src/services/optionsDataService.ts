/**
 * optionsDataService — single entry point for option-chain enrichment.
 *
 * Wraps `enrichWithPublicChain` and emits a TrustEnvelope per pick key, so
 * downstream scoring/UI never sees a raw contract without provenance,
 * freshness, and validation state.
 */

import { enrichWithPublicChain, type EnrichedContract, type EnrichmentResult } from "@/lib/chain.functions";
import type { Direction, EntryMode } from "@/lib/types";
import type { PreferenceMode } from "@/lib/contractPreference";
import type { TrustEnvelope, DataSource } from "./trust";
import { wrap, unavailable, errored } from "./trust";

export type { EnrichedContract, EnrichmentResult };

export interface OptionsPickInput {
  ticker: string;
  direction: Direction;
  isLeaps?: boolean;
  isYolo?: boolean;
  entryMode?: EntryMode;
  targetStrike?: number;
}

/** Global contract-selection preference applied to ALL picks in a single scan. */
export interface OptionsChainPreference {
  preferenceMode?: PreferenceMode;
  maxContractCost?: number;
}

export interface OptionsChainResult {
  /** TrustEnvelope per pick key. Always populated for every requested pick. */
  envelopes: Record<string, TrustEnvelope<EnrichedContract>>;
  /** Raw enrichment result for legacy callers and debug surfaces. */
  raw: EnrichmentResult;
  live: boolean;
  rateLimited: boolean;
  retryInMs: number;
  retryAt: number | null;
  message: string | null;
}

function mapSource(s: EnrichedContract["source"]): DataSource {
  if (s === "public") return "public-chain";
  if (s === "massive") return "computed";
  return null;
}

function validateEnriched(e: EnrichedContract | null): e is EnrichedContract {
  if (!e) return false;
  const c = e.contract;
  if (!c) return false;
  if (!Number.isFinite(c.strike) || c.strike <= 0) return false;
  if (!Number.isFinite(c.ask) || c.ask < 0) return false;
  if (!c.expiration) return false;
  if (!Number.isFinite(e.underlyingPrice) || e.underlyingPrice <= 0) return false;
  return true;
}

export async function fetchOptionsChainEnvelopes(
  picks: OptionsPickInput[],
): Promise<OptionsChainResult> {
  const empty: EnrichmentResult = {
    enriched: {},
    live: false,
    rateLimited: false,
    retryInMs: 0,
    retryAt: null,
    message: null,
  };
  if (picks.length === 0) {
    return {
      envelopes: {},
      raw: empty,
      live: false,
      rateLimited: false,
      retryInMs: 0,
      retryAt: null,
      message: null,
    };
  }
  try {
    const res = await enrichWithPublicChain({ data: { picks } });
    const fetchedAt = Date.now();
    const envelopes: Record<string, TrustEnvelope<EnrichedContract>> = {};
    for (const [key, value] of Object.entries(res.enriched)) {
      if (!value) {
        envelopes[key] = unavailable<EnrichedContract>(
          "no-chain",
          res.rateLimited
            ? "Chain provider rate-limited"
            : `No contract returned for ${key}`,
        );
        continue;
      }
      const validated = validateEnriched(value);
      envelopes[key] = wrap<EnrichedContract>({
        value: validated ? value : null,
        source: mapSource(value.source),
        fetchedAt,
        validated,
      });
    }
    return {
      envelopes,
      raw: res,
      live: res.live,
      rateLimited: res.rateLimited,
      retryInMs: res.retryInMs,
      retryAt: res.retryAt,
      message: res.message,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const envelopes: Record<string, TrustEnvelope<EnrichedContract>> = {};
    for (const p of picks) {
      const key = `${p.ticker}:${p.direction}`;
      envelopes[key] = errored<EnrichedContract>("provider-error", msg);
    }
    return {
      envelopes,
      raw: empty,
      live: false,
      rateLimited: false,
      retryInMs: 0,
      retryAt: null,
      message: msg,
    };
  }
}
