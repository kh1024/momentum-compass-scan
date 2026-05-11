/**
 * Massive repair endpoints — server-only.
 *
 * Two narrow helpers used by the data-quality flow:
 *
 *  1. `fetchContractSnapshot(underlying, occSymbol)` →
 *     calls `/v3/snapshot/options/{underlying}/{occSymbol}` to refresh quote,
 *     Greeks, IV, OI, volume, breakeven and underlying price for ONE contract.
 *
 *  2. `fetchOptionQuote(occSymbol)` →
 *     calls `/v3/quotes/{optionsTicker}?limit=1&sort=sip_timestamp&order=desc`
 *     to verify the latest bid/ask only.
 *
 * Both are intentionally cheap (single contract) and are only called as a
 * second pass for contracts that arrived from the chain snapshot with
 * missing fields.
 */

import { massiveClient } from "./massiveClient";
import { buildCacheKey } from "./apiCache";
import { getScannerSettings } from "./scannerQueue";
import type { OptionContractData } from "./optionDataQuality";

interface ContractSnapshotRow {
  break_even_price?: number;
  day?: { volume?: number };
  details?: {
    contract_type?: "call" | "put";
    expiration_date?: string;
    strike_price?: number;
    ticker?: string;
  };
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
  implied_volatility?: number;
  last_quote?: { ask?: number; bid?: number; midpoint?: number };
  last_trade?: { price?: number };
  open_interest?: number;
  underlying_asset?: { price?: number };
}
interface ContractSnapshotResponse {
  results?: ContractSnapshotRow;
}

interface QuoteRow {
  bid_price?: number;
  ask_price?: number;
}
interface QuotesResponse {
  results?: QuoteRow[];
}

/** Merge a snapshot row into an existing contract, only filling NULL fields. */
function mergeSnapshot(
  c: OptionContractData,
  row: ContractSnapshotRow,
): OptionContractData {
  const greeks = row.greeks ?? {};
  const q = row.last_quote ?? {};
  const merged: OptionContractData = {
    ...c,
    bid: c.bid ?? (Number.isFinite(q.bid) ? Number(q.bid) : null),
    ask: c.ask ?? (Number.isFinite(q.ask) ? Number(q.ask) : null),
    latestTrade: c.latestTrade ?? (Number.isFinite(row.last_trade?.price) ? Number(row.last_trade!.price) : null),
    delta: c.delta ?? (Number.isFinite(greeks.delta) ? Number(greeks.delta) : null),
    gamma: c.gamma ?? (Number.isFinite(greeks.gamma) ? Number(greeks.gamma) : null),
    theta: c.theta ?? (Number.isFinite(greeks.theta) ? Number(greeks.theta) : null),
    vega: c.vega ?? (Number.isFinite(greeks.vega) ? Number(greeks.vega) : null),
    impliedVolatility: c.impliedVolatility ?? (Number.isFinite(row.implied_volatility) ? Number(row.implied_volatility) : null),
    openInterest: c.openInterest ?? (Number.isFinite(row.open_interest) ? Number(row.open_interest) : null),
    volume: c.volume ?? (Number.isFinite(row.day?.volume) ? Number(row.day!.volume) : null),
    breakeven: c.breakeven ?? (Number.isFinite(row.break_even_price) ? Number(row.break_even_price) : null),
    underlyingPrice: c.underlyingPrice ?? (Number.isFinite(row.underlying_asset?.price) ? Number(row.underlying_asset!.price) : null),
  };
  // Recompute spread from new bid/ask if it was missing.
  if (merged.spreadPct == null && merged.ask && merged.bid && merged.ask > 0) {
    merged.spreadPct = Math.max(0, (merged.ask - merged.bid) / merged.ask);
  }
  return merged;
}

export async function fetchContractSnapshot(
  underlying: string,
  occSymbol: string,
  signal?: AbortSignal,
): Promise<ContractSnapshotRow | null> {
  const sym = underlying.trim().toUpperCase();
  const path = `/v3/snapshot/options/${encodeURIComponent(sym)}/${encodeURIComponent(occSymbol)}`;
  const cacheKey = buildCacheKey(["massive", "contract-snapshot", sym, occSymbol]);
  const r = await massiveClient<ContractSnapshotResponse>(path, {
    ticker: sym,
    cacheKey,
    ttlMs: getScannerSettings().optionChainTtlMs,
    signal,
  });
  return r.data?.results ?? null;
}

export async function fetchOptionQuote(
  occSymbol: string,
  signal?: AbortSignal,
): Promise<{ bid: number | null; ask: number | null } | null> {
  const path = `/v3/quotes/${encodeURIComponent(occSymbol)}?limit=1&sort=sip_timestamp&order=desc`;
  const cacheKey = buildCacheKey(["massive", "quote", occSymbol]);
  const r = await massiveClient<QuotesResponse>(path, {
    cacheKey,
    ttlMs: getScannerSettings().quoteTtlMs,
    signal,
  });
  const row = r.data?.results?.[0];
  if (!row) return null;
  return {
    bid: Number.isFinite(row.bid_price) && Number(row.bid_price) > 0 ? Number(row.bid_price) : null,
    ask: Number.isFinite(row.ask_price) && Number(row.ask_price) > 0 ? Number(row.ask_price) : null,
  };
}

const REPAIR_TIMEOUT_MS = 6_000;

/**
 * Run the full repair flow on a contract: contract snapshot first, then
 * quotes endpoint if bid/ask still missing. Returns the (possibly improved)
 * contract plus which endpoint(s) were used.
 *
 * Accepts an optional signal; always enforces an internal REPAIR_TIMEOUT_MS
 * hard-stop so repair never blocks the Workers runtime past its time budget.
 */
export async function repairContract(
  c: OptionContractData,
  externalSignal?: AbortSignal,
): Promise<{ contract: OptionContractData; endpoint: "contract-snapshot" | "quotes" | "contract-snapshot+quotes" | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPAIR_TIMEOUT_MS);
  // If the caller provides a signal, propagate its abort into our controller.
  externalSignal?.addEventListener("abort", () => controller.abort(), { once: true });
  const signal = controller.signal;

  let contract = c;
  let endpoint: "contract-snapshot" | "quotes" | "contract-snapshot+quotes" | null = null;
  try {
    try {
      const snap = await fetchContractSnapshot(c.underlyingTicker, c.optionTicker, signal);
      if (snap) {
        contract = mergeSnapshot(contract, snap);
        endpoint = "contract-snapshot";
      }
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") {
        console.warn(`[optionRepair] snapshot failed for ${c.optionTicker}`, e);
      }
    }
    if (!contract.bid || !contract.ask) {
      try {
        const q = await fetchOptionQuote(c.optionTicker, signal);
        if (q) {
          contract = {
            ...contract,
            bid: contract.bid ?? q.bid,
            ask: contract.ask ?? q.ask,
          };
          endpoint = endpoint ? "contract-snapshot+quotes" : "quotes";
          if (contract.spreadPct == null && contract.ask && contract.bid && contract.ask > 0) {
            contract.spreadPct = Math.max(0, (contract.ask - contract.bid) / contract.ask);
          }
        }
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") {
          console.warn(`[optionRepair] quote failed for ${c.optionTicker}`, e);
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { contract, endpoint };
}
