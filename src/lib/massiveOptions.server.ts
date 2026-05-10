/** Massive option-chain snapshot provider — server-only. */
import { buildCacheKey, readApiCache, writeApiCache } from "./apiCache";
import { getScannerSettings } from "./scannerQueue";
import { massiveClient } from "./massiveClient";
import type { Direction } from "./types";

export interface MassiveOptionContract {
  symbol: string;
  occSymbol: string;
  type: Direction;
  strike: number;
  expiration: string;
  dte: number;
  bid: number;
  ask: number;
  mid: number;
  spreadPct: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  volume: number;
  openInterest: number;
  breakeven: number;
  expectedMovePct: number;
}

export interface MassiveOptionChain {
  symbol: string;
  underlyingPrice: number;
  expectedMovePct: number;
  contracts: MassiveOptionContract[];
}

interface MassiveSnapshotRow {
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
  open_interest?: number;
  underlying_asset?: { price?: number };
}

interface MassiveSnapshotResponse {
  results?: MassiveSnapshotRow[];
  next_url?: string;
}

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function dteFromIso(iso: string): number {
  const expMs = Date.parse(`${iso}T00:00:00Z`);
  if (!isFinite(expMs)) return 0;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((expMs - today) / 86_400_000));
}

function rangeForStyle(opts?: { isLeaps?: boolean; isYolo?: boolean }): { min: number; max: number } {
  if (opts?.isLeaps) return { min: 270, max: 540 };
  if (opts?.isYolo) return { min: 1, max: 7 };
  // Default: ~7-day swing window (4–10 DTE).
  return { min: 4, max: 10 };
}

function toContract(symbol: string, row: MassiveSnapshotRow): MassiveOptionContract | null {
  const d = row.details;
  const type = d?.contract_type === "call" ? "CALL" : d?.contract_type === "put" ? "PUT" : null;
  const expiration = d?.expiration_date;
  const strike = Number(d?.strike_price);
  const underlyingPrice = Number(row.underlying_asset?.price ?? 0);
  if (!type || !expiration || !isFinite(strike) || strike <= 0) return null;
  const bid = Math.max(0, Number(row.last_quote?.bid ?? 0));
  const ask = Math.max(0, Number(row.last_quote?.ask ?? 0));
  const mid = Math.max(0, Number(row.last_quote?.midpoint ?? (ask && bid ? (ask + bid) / 2 : ask || bid)));
  const dte = dteFromIso(expiration);
  const iv = Math.max(0, Number(row.implied_volatility ?? 0));
  const breakeven = Number(row.break_even_price ?? (type === "CALL" ? strike + mid : strike - mid));
  return {
    symbol,
    occSymbol: d?.ticker ?? `${symbol}-${expiration}-${type}-${strike}`,
    type,
    strike,
    expiration,
    dte,
    bid,
    ask,
    mid,
    spreadPct: ask > 0 ? Math.max(0, (ask - bid) / ask) : 1,
    iv,
    delta: Number(row.greeks?.delta ?? 0),
    gamma: Number(row.greeks?.gamma ?? 0),
    theta: Number(row.greeks?.theta ?? 0),
    vega: Number(row.greeks?.vega ?? 0),
    volume: Math.max(0, Number(row.day?.volume ?? 0)),
    openInterest: Math.max(0, Number(row.open_interest ?? 0)),
    breakeven,
    expectedMovePct: iv > 0 && dte > 0 ? iv * Math.sqrt(dte / 365) : 0,
  };
}

export async function fetchMassiveOptionChain(
  symbol: string,
  direction: Direction,
  opts?: { isLeaps?: boolean; isYolo?: boolean },
): Promise<MassiveOptionChain | null> {
  const sym = symbol.trim().toUpperCase();
  const range = rangeForStyle(opts);
  const expGte = isoDaysFromNow(range.min);
  const expLte = isoDaysFromNow(range.max);
  const contractType = direction === "CALL" ? "call" : "put";
  const cacheKey = buildCacheKey(["massive", "option-snapshot", sym, contractType, expGte, expLte]);
  const cached = readApiCache<MassiveOptionChain>(cacheKey);
  if (cached) return cached.value;

  const params = new URLSearchParams({
    contract_type: contractType,
    "expiration_date.gte": expGte,
    "expiration_date.lte": expLte,
    sort: "expiration_date",
    order: "asc",
    limit: "250",
  });
  const result = await massiveClient<MassiveSnapshotResponse>(
    `/v3/snapshot/options/${encodeURIComponent(sym)}?${params.toString()}`,
    { ticker: sym, ttlMs: getScannerSettings().optionChainTtlMs, cacheKey },
  );
  if (!result.data?.results?.length) return null;
  const contracts = result.data.results.map((r) => toContract(sym, r)).filter((c): c is MassiveOptionContract => !!c);
  if (contracts.length === 0) return null;
  const underlyingPrice = contracts.map((c, i) => Number(result.data?.results?.[i]?.underlying_asset?.price ?? 0)).find((n) => n > 0) ?? 0;
  const nearest = contracts.slice().sort((a, b) => a.dte - b.dte)[0]?.dte ?? 0;
  const atm = contracts
    .filter((c) => c.dte === nearest)
    .sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice))[0];
  const chain = { symbol: sym, underlyingPrice, expectedMovePct: atm?.expectedMovePct ?? 0, contracts };
  writeApiCache(cacheKey, chain, getScannerSettings().optionChainTtlMs);
  return chain;
}