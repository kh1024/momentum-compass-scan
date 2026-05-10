/**
 * Public.com brokerage API — server-only quote provider.
 * Flow: PUBLIC_COM_API_KEY → access token → accountId → /quotes
 * State is module-level cache (per-isolate). 90s cooldown on 429.
 */
import { recordRateLimit } from "./rateLimitLog.server";
import { fetchWithRetry } from "./fetchRetry.server";
import { buildCacheKey, readApiCache, writeApiCache } from "./apiCache";
import { logApiHealth } from "./apiHealthLogger";
import { getScannerSettings, normalizeTickers } from "./scannerQueue";
import type { EntryMode } from "./types";

const PUBLIC_BASE = "https://api.public.com";
const TOKEN_TTL_MIN = 60;
const REFRESH_BEFORE_MS = 10 * 60 * 1000;
const COOLDOWN_BASE_MS = 30_000;     // first 429 → 30s
const COOLDOWN_MAX_MS = 10 * 60_000; // cap at 10 min

let cachedToken: { value: string; expiresAt: number } | null = null;
let cachedAccountId: string | null = null;
let inflightToken: Promise<string> | null = null;
let inflightAccount: Promise<string> | null = null;
let cooldownUntil = 0;
let consecutive429 = 0;

export class PublicRateLimitError extends Error {
  rateLimited = true as const;
  retryAfterMs: number;
  retryAt: number;
  constructor(retryAfterMs: number) {
    super(
      `Public.com is rate-limiting requests. Retrying in ${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = "PublicRateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.retryAt = Date.now() + retryAfterMs;
  }
}

export function isPublicRateLimited(e: unknown): e is PublicRateLimitError {
  return Boolean(e && typeof e === "object" && (e as { rateLimited?: boolean }).rateLimited);
}

export function publicConfigured(): boolean {
  return Boolean(process.env.PUBLIC_COM_API_KEY);
}

export function getPublicCooldownStatus(): {
  rateLimited: boolean;
  remainingMs: number;
  retryAt: number | null;
} {
  const remainingMs = Math.max(0, cooldownUntil - Date.now());
  return {
    rateLimited: remainingMs > 0,
    remainingMs,
    retryAt: remainingMs > 0 ? cooldownUntil : null,
  };
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const sec = Number(h);
  if (isFinite(sec) && sec > 0) return Math.min(sec * 1000, COOLDOWN_MAX_MS);
  const date = Date.parse(h);
  if (isFinite(date)) return Math.max(0, Math.min(date - Date.now(), COOLDOWN_MAX_MS));
  return null;
}

function tripCooldown(retryAfterMs: number | null, context: string): never {
  consecutive429 = Math.min(consecutive429 + 1, 10);
  // Exponential backoff with header override
  const backoff = Math.min(COOLDOWN_BASE_MS * 2 ** (consecutive429 - 1), COOLDOWN_MAX_MS);
  const wait = retryAfterMs ?? backoff;
  cooldownUntil = Date.now() + wait;
  recordRateLimit({
    provider: "public",
    context,
    retryAfterMs: wait,
    retryAt: cooldownUntil,
    source: retryAfterMs != null ? "header" : "backoff",
  });
  throw new PublicRateLimitError(wait);
}

function noteSuccess() {
  if (consecutive429 > 0) consecutive429 = 0;
}

function guardCooldown() {
  const remaining = Math.max(0, cooldownUntil - Date.now());
  if (remaining > 0) throw new PublicRateLimitError(remaining);
}


async function mintToken(secret: string): Promise<string> {
  const r = await fetchWithRetry(`${PUBLIC_BASE}/userapiauthservice/personal/access-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "momentum-options" },
    body: JSON.stringify({ validityInMinutes: TOKEN_TTL_MIN, secret }),
  });
  if (r.status === 429) tripCooldown(parseRetryAfter(r.headers.get("retry-after")), "auth/access-tokens");
  if (r.ok) noteSuccess();
  if (!r.ok) throw new Error(`Public.com auth ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { accessToken?: string };
  if (!j.accessToken) throw new Error("Public.com auth: missing accessToken");
  cachedToken = { value: j.accessToken, expiresAt: Date.now() + TOKEN_TTL_MIN * 60_000 - REFRESH_BEFORE_MS };
  return j.accessToken;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  guardCooldown();
  const secret = process.env.PUBLIC_COM_API_KEY;
  if (!secret) throw new Error("PUBLIC_COM_API_KEY is not configured");
  if (inflightToken) return inflightToken;
  inflightToken = mintToken(secret).finally(() => { inflightToken = null; });
  return inflightToken;
}

async function fetchAccountId(token: string): Promise<string> {
  const r = await fetchWithRetry(`${PUBLIC_BASE}/userapigateway/trading/account`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "momentum-options" },
  });
  if (r.status === 429) tripCooldown(parseRetryAfter(r.headers.get("retry-after")), "trading/account");
  if (r.ok) noteSuccess();
  if (!r.ok) {
    const body = (await r.text()).slice(0, 400);
    throw new Error(`Public.com accounts ${r.status}: ${body || "(verify API access enabled at public.com/settings/v2/api)"}`);
  }
  const j = (await r.json()) as { accounts?: { accountId: string; accountType?: string }[] };
  const id = j.accounts?.find((a) => a.accountType === "BROKERAGE")?.accountId ?? j.accounts?.[0]?.accountId;
  if (!id) throw new Error("Public.com accounts: response had no accounts");
  cachedAccountId = id;
  return id;
}

async function getAccountId(token: string): Promise<string> {
  if (cachedAccountId) return cachedAccountId;
  guardCooldown();
  if (inflightAccount) return inflightAccount;
  inflightAccount = fetchAccountId(token).finally(() => { inflightAccount = null; });
  return inflightAccount;
}

export interface PublicQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  ts: number;
}

interface PublicQuoteRow {
  outcome?: string;
  instrument: { symbol: string };
  last?: number;
  lastTimestamp?: string;
  previousClose?: number;
  oneDayChange?: { change?: number; percentChange?: number };
}

export async function fetchPublicQuotes(symbols: string[]): Promise<Record<string, PublicQuote | null>> {
  const out: Record<string, PublicQuote | null> = {};
  if (!publicConfigured() || symbols.length === 0) return out;
  try {
    const token = await getToken();
    const accountId = await getAccountId(token);
    const upper = normalizeTickers(symbols, 50);
    const r = await fetchWithRetry(`${PUBLIC_BASE}/userapigateway/marketdata/${accountId}/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "momentum-options",
      },
      body: JSON.stringify({ instruments: upper.map((symbol) => ({ symbol, type: "EQUITY" })) }),
    });
    if (r.status === 429) tripCooldown(parseRetryAfter(r.headers.get("retry-after")), `quotes ${upper.join(",")}`);
  if (r.ok) noteSuccess();
    if (!r.ok) throw new Error(`Public.com quotes ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { quotes?: PublicQuoteRow[] };
    for (const q of j.quotes ?? []) {
      if (q.outcome !== "SUCCESS" || q.last == null) continue;
      const sym = q.instrument.symbol.toUpperCase();
      out[sym] = {
        symbol: sym,
        price: Number(q.last),
        change: Number(q.oneDayChange?.change ?? 0),
        changePct: Number(q.oneDayChange?.percentChange ?? 0),
        ts: q.lastTimestamp ? new Date(q.lastTimestamp).getTime() : Date.now(),
      };
    }
  } catch (e) {
    console.warn("[public.com] quotes failed", e);
    throw e;
  }
  return out;
}

export async function fetchPublicQuote(symbol: string): Promise<PublicQuote | null> {
  const map = await fetchPublicQuotes([symbol]);
  return map[symbol.toUpperCase()] ?? null;
}

// ───────────────────────── Option Chain ─────────────────────────

export type OptionType = "CALL" | "PUT";

export interface PublicOptionContract {
  symbol: string;        // underlying
  occSymbol: string;     // OCC option symbol
  type: OptionType;
  strike: number;
  expiration: string;    // ISO date
  dte: number;
  bid: number;
  ask: number;
  mid: number;
  spreadPct: number;
  iv: number;            // 0-1
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  volume: number;
  openInterest: number;
  breakeven: number;
  expectedMovePct: number; // 1σ move over DTE: IV * sqrt(DTE/365)
}

export interface PublicOptionChain {
  symbol: string;
  underlyingPrice: number;
  expectedMovePct: number; // ATM 1σ for nearest expiration
  contracts: PublicOptionContract[];
  /** True when this chain came from in-memory cache (not a fresh HTTP call). */
  cached?: boolean;
  /** Endpoint that produced this chain (for debug panels). */
  endpoint?: string;
  /** Epoch ms when this chain row was produced or pulled from cache. */
  fetchedAt?: number;
}

interface RawChainContract {
  symbol?: string;
  occSymbol?: string;
  type?: string;
  optionType?: string;
  strike?: number;
  strikePrice?: number;
  expiration?: string;
  expirationDate?: string;
  bid?: number;
  ask?: number;
  iv?: number;
  impliedVolatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  volume?: number;
  openInterest?: number;
}

interface RawChainResponse {
  underlyingPrice?: number;
  contracts?: RawChainContract[];
  expirations?: { date?: string; expiration?: string; contracts?: RawChainContract[] }[];
}

function dteFromIso(iso: string): number {
  const t = new Date(iso).getTime();
  return Math.max(0, Math.round((t - Date.now()) / 86_400_000));
}

function normalizeContract(
  underlyingSymbol: string,
  underlyingPrice: number,
  raw: RawChainContract,
  fallbackExpiration?: string,
): PublicOptionContract | null {
  const strike = Number(raw.strike ?? raw.strikePrice);
  const expIso = raw.expiration ?? raw.expirationDate ?? fallbackExpiration;
  const typeStr = (raw.type ?? raw.optionType ?? "").toUpperCase();
  const type: OptionType | null =
    typeStr === "CALL" || typeStr === "C" ? "CALL" :
    typeStr === "PUT" || typeStr === "P" ? "PUT" : null;
  if (!type || !expIso || !isFinite(strike) || strike <= 0) return null;

  const bid = Math.max(0, Number(raw.bid ?? 0));
  const ask = Math.max(0, Number(raw.ask ?? 0));
  const mid = ask > 0 && bid > 0 ? (bid + ask) / 2 : ask || bid;
  const spreadPct = ask > 0 ? Math.max(0, (ask - bid) / ask) : 1;
  const iv = Math.max(0, Number(raw.iv ?? raw.impliedVolatility ?? 0));
  const delta = Number(raw.delta ?? 0);
  const theta = Number(raw.theta ?? 0);
  const dte = dteFromIso(expIso);
  const breakeven = type === "CALL" ? strike + mid : strike - mid;
  const expectedMovePct = iv > 0 && dte > 0 ? iv * Math.sqrt(dte / 365) : 0;

  return {
    symbol: underlyingSymbol,
    occSymbol: raw.occSymbol ?? raw.symbol ?? `${underlyingSymbol}-${expIso}-${type}-${strike}`,
    type, strike, expiration: expIso, dte,
    bid, ask, mid, spreadPct, iv,
    delta, gamma: Number(raw.gamma ?? 0), theta, vega: Number(raw.vega ?? 0),
    volume: Math.max(0, Number(raw.volume ?? 0)),
    openInterest: Math.max(0, Number(raw.openInterest ?? 0)),
    breakeven, expectedMovePct,
  };
}

/**
 * Public.com option-chain fetch.
 * Endpoint shape varies; we try the documented v2 chain path and fall back.
 * If Public.com doesn't expose a chain on your account tier, this throws and
 * the caller must degrade to demo data.
 */
export async function fetchPublicOptionChain(symbol: string): Promise<PublicOptionChain> {
  if (!publicConfigured()) throw new Error("PUBLIC_COM_API_KEY is not configured");
  const sym = symbol.trim().toUpperCase();
  const cacheKey = buildCacheKey(["public", "option-chain", sym]);
  const cached = readApiCache<PublicOptionChain>(cacheKey);
  if (cached) {
    logApiHealth({ endpoint: "public option-chain", ticker: sym, statusCode: 200, responseTimeMs: 0, cached: true, retryCount: 0, rateLimited: false, errorMessage: null });
    return { ...cached.value, cached: true, endpoint: "public option-chain", fetchedAt: Date.now() };
  }
  const start = Date.now();
  const token = await getToken();
  const accountId = await getAccountId(token);

  const url = `${PUBLIC_BASE}/userapigateway/marketdata/${accountId}/option-chain/${encodeURIComponent(sym)}`;
  const r = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "momentum-options" },
  });
  if (r.status === 429) tripCooldown(parseRetryAfter(r.headers.get("retry-after")), `option-chain ${sym}`);
  if (r.ok) noteSuccess();
  if (!r.ok) {
    const errorMessage = `Public.com option-chain ${r.status}: ${(await r.text()).slice(0, 200)}`;
    logApiHealth({ endpoint: "public option-chain", ticker: sym, statusCode: r.status, responseTimeMs: Date.now() - start, cached: false, retryCount: 0, rateLimited: false, errorMessage });
    throw new Error(errorMessage);
  }

  const j = (await r.json()) as RawChainResponse;
  const underlyingPrice = Number(j.underlyingPrice ?? 0);

  const contracts: PublicOptionContract[] = [];
  if (Array.isArray(j.contracts)) {
    for (const raw of j.contracts) {
      const c = normalizeContract(sym, underlyingPrice, raw);
      if (c) contracts.push(c);
    }
  } else if (Array.isArray(j.expirations)) {
    for (const exp of j.expirations) {
      const expIso = exp.date ?? exp.expiration;
      for (const raw of exp.contracts ?? []) {
        const c = normalizeContract(sym, underlyingPrice, raw, expIso);
        if (c) contracts.push(c);
      }
    }
  }

  // Underlying-level expected move = ATM 1σ for nearest expiration
  let expectedMovePct = 0;
  if (contracts.length > 0 && underlyingPrice > 0) {
    const nearest = contracts.slice().sort((a, b) => a.dte - b.dte)[0]?.dte ?? 0;
    const atm = contracts
      .filter(c => c.dte === nearest)
      .sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice))[0];
    expectedMovePct = atm?.expectedMovePct ?? 0;
  }

  const chain: PublicOptionChain = { symbol: sym, underlyingPrice, expectedMovePct, contracts };
  writeApiCache(cacheKey, chain, getScannerSettings().optionChainTtlMs);
  logApiHealth({ endpoint: "public option-chain", ticker: sym, statusCode: r.status, responseTimeMs: Date.now() - start, cached: false, retryCount: 0, rateLimited: false, errorMessage: null });
  return { ...chain, cached: false, endpoint: "public option-chain", fetchedAt: Date.now() };
}

export interface ContractSelector {
  direction: OptionType;
  isLeaps?: boolean;
  isYolo?: boolean;
  entryMode?: EntryMode;
  targetStrike?: number;
  /** Hard filter: when set, only contracts with `expiration === selectedExpiration` may be picked. */
  selectedExpiration?: string;
}

export interface ContractTraceRow {
  occSymbol: string;
  expiration: string;
  dte: number;
  strike: number;
  bid: number;
  ask: number;
  delta: number;
  theta: number;
  iv: number;
  volume: number;
  openInterest: number;
  spreadPct: number;
  pass: boolean;
  failReason?: string;
  selected: boolean;
}

export interface ContractSelectionResult {
  contract: PublicOptionContract | null;
  /**
   *  - "user-filter"     → user picked the expiration; contract chosen from that expiration only.
   *  - "best-score"      → no expiration selected; best within DTE bucket by score.
   *  - "default-bucket"  → DTE bucket fell back (no contracts in primary window).
   *  - "none"            → nothing selectable (empty chain or empty filtered pool).
   */
  reason: "user-filter" | "best-score" | "default-bucket" | "none";
  /** True when caller passed a selectedExpiration that was hard-applied. */
  selectionFilterApplied: boolean;
  /** Per-contract decision rows (top 25 considered + winner). */
  trace: ContractTraceRow[];
}

function makeRow(c: PublicOptionContract, pass: boolean, failReason: string | undefined, selected: boolean): ContractTraceRow {
  return {
    occSymbol: c.occSymbol, expiration: c.expiration, dte: c.dte, strike: c.strike,
    bid: c.bid, ask: c.ask, delta: c.delta, theta: c.theta, iv: c.iv,
    volume: c.volume, openInterest: c.openInterest, spreadPct: c.spreadPct,
    pass, failReason, selected,
  };
}

/** Pick the most appropriate contract from a chain for a given setup. */
export function selectContractFromChain(
  chain: PublicOptionChain,
  sel: ContractSelector,
): ContractSelectionResult {
  const dirMatches = chain.contracts.filter(c => c.type === sel.direction);
  if (dirMatches.length === 0) {
    return { contract: null, reason: "none", selectionFilterApplied: !!sel.selectedExpiration, trace: [] };
  }

  // HARD FILTER: when user picked an exact expiration, scanner may only
  // choose contracts from that expiration — never fall back to another.
  if (sel.selectedExpiration) {
    const matched = dirMatches.filter(c => c.expiration === sel.selectedExpiration);
    if (matched.length === 0) {
      const trace: ContractTraceRow[] = dirMatches.slice(0, 25).map((c) =>
        makeRow(c, false, `expiration ${c.expiration} ≠ selected ${sel.selectedExpiration}`, false),
      );
      return { contract: null, reason: "user-filter", selectionFilterApplied: true, trace };
    }
    const winner = pickBest(matched, chain.underlyingPrice, sel);
    const trace = matched.slice(0, 25).map((c) => makeRow(c, true, undefined, c === winner));
    return { contract: winner, reason: "user-filter", selectionFilterApplied: true, trace };
  }

  // No user-selected expiration → DTE window.
  const inDte = dirMatches.filter(c => {
    if (sel.isLeaps) return c.dte >= 270 && c.dte <= 540;
    if (sel.isYolo) return c.dte >= 1 && c.dte <= 14;
    return c.dte >= 14 && c.dte <= 45;
  });
  const fellBack = inDte.length === 0;
  const pool = inDte.length > 0 ? inDte : dirMatches;
  const winner = pickBest(pool, chain.underlyingPrice, sel);
  const trace = pool.slice(0, 25).map((c) => makeRow(c, true, undefined, c === winner));
  return {
    contract: winner,
    reason: fellBack ? "default-bucket" : "best-score",
    selectionFilterApplied: false,
    trace,
  };
}

function pickBest(pool: PublicOptionContract[], underlyingPrice: number, sel: ContractSelector): PublicOptionContract | null {
  const target = sel.isLeaps ? 0.7 : sel.isYolo ? 0.2 : sel.entryMode === "Support Reclaim" ? 0.48 : 0.4;
  const targetStrike = Number.isFinite(sel.targetStrike) && sel.targetStrike && sel.targetStrike > 0
    ? sel.targetStrike
    : underlyingPrice;
  return pool
    .slice()
    .sort((a, b) => {
      const da = Math.abs(Math.abs(a.delta) - target);
      const db = Math.abs(Math.abs(b.delta) - target);
      const sa = Math.abs(a.strike - targetStrike) / Math.max(1, targetStrike);
      const sb = Math.abs(b.strike - targetStrike) / Math.max(1, targetStrike);
      if (sel.entryMode === "Support Reclaim" && sa !== sb) return sa - sb;
      if (sel.entryMode === "Breakout" && Math.abs(sa - sb) > 0.01) return sa - sb;
      if (da !== db) return da - db;
      if (a.spreadPct !== b.spreadPct) return a.spreadPct - b.spreadPct;
      return b.openInterest - a.openInterest;
    })[0] ?? null;
}

