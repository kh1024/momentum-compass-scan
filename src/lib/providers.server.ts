/**
 * Multi-source quote provider — server-only.
 * Aggregates Massive (keyed) + Public.com (keyed) + Finnhub (keyed)
 *   + Yahoo + Stooq + CoinGecko (all free, no key).
 * Consensus rule: freshest timestamp wins. Cross-checked across sources.
 */

import { fetchMassiveQuote, massiveConfigured, getMassiveCooldownStatus, isMassiveEnabled, type MassiveQuote } from "./massive.server";
import { fetchPublicQuote, publicConfigured, getPublicCooldownStatus, type PublicQuote } from "./publicCom.server";
import { fetchWithRetry } from "./fetchRetry.server";
import { normalizeTickers } from "./scannerQueue";

export type { SourceName, ConsensusQuote } from "@/lib/quote-types";
import type { SourceName, ConsensusQuote } from "@/lib/quote-types";

export interface SourceQuote {
  source: SourceName;
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  ts: number; // epoch ms
}

const YAHOO_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const YAHOO_HEADERS = {
  "User-Agent": YAHOO_UA,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://finance.yahoo.com",
  "Referer": "https://finance.yahoo.com/",
};

// ── Yahoo crumb/cookie session (required since mid-2024) ──
const YAHOO_CRUMB_TTL_MS = 50 * 60 * 1000; // 50 minutes
let yahooCrumbCache: { crumb: string; cookie: string; expires: number } | null = null;

async function getYahooCrumb(force = false): Promise<{ crumb: string; cookie: string } | null> {
  const now = Date.now();
  if (!force && yahooCrumbCache && yahooCrumbCache.expires > now) {
    return { crumb: yahooCrumbCache.crumb, cookie: yahooCrumbCache.cookie };
  }
  try {
    const r = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: YAHOO_HEADERS,
    });
    if (!r.ok) return null;
    const crumb = (await r.text()).trim();
    if (!crumb) return null;
    // Collect Set-Cookie headers (Yahoo sets A1/A3 session cookies)
    const setCookies: string[] = [];
    const headersAny = r.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof headersAny.getSetCookie === "function") {
      setCookies.push(...headersAny.getSetCookie());
    } else {
      const sc = r.headers.get("set-cookie");
      if (sc) setCookies.push(sc);
    }
    const cookie = setCookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    yahooCrumbCache = { crumb, cookie, expires: now + YAHOO_CRUMB_TTL_MS };
    return { crumb, cookie };
  } catch (e) {
    console.warn("[yahoo] crumb fetch failed", e);
    return null;
  }
}

// ── Yahoo (free) ──
// Strategy:
//   1) Try the crumb-free `query1` chart endpoint first. From Cloudflare
//      Workers the crumb/cookie flow on `query2` is unreliable (set-cookie
//      isn't always echoed), but `query1` returns chart data anonymously.
//   2) Fall back to `query2` with a fresh crumb only if `query1` blocks.
async function fetchYahoo(symbol: string): Promise<SourceQuote | null> {
  const sym = symbol.toUpperCase();
  // Anonymous query1 path (works without crumb in most regions).
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
    const r = await fetchWithRetry(url, {
      headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
    });
    if (r.ok) {
      const parsed = parseYahooChart(await r.json(), sym);
      if (parsed) return parsed;
    }
  } catch (e) {
    console.warn(`[yahoo q1] ${sym}`, e);
  }
  // Crumb fallback path.
  try {
    const session = await getYahooCrumb(true);
    const qs = `interval=1d&range=5d${session?.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : ""}`;
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${qs}`;
    const headers: Record<string, string> = { "User-Agent": YAHOO_UA, Accept: "application/json" };
    if (session?.cookie) headers["Cookie"] = session.cookie;
    const r = await fetchWithRetry(url, { headers });
    if (!r.ok) return null;
    return parseYahooChart(await r.json(), sym);
  } catch (e) {
    console.warn(`[yahoo q2] ${sym}`, e);
    return null;
  }
}

function parseYahooChart(d: unknown, sym: string): SourceQuote | null {
  const data = d as {
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketPrice?: number;
          chartPreviousClose?: number;
          previousClose?: number;
          regularMarketVolume?: number;
          regularMarketTime?: number;
        };
      }>;
    };
  };
  const meta = data.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!isFinite(price) || price <= 0) return null;
  const prev = Number(meta?.chartPreviousClose ?? meta?.previousClose ?? 0);
  const change = isFinite(prev) && prev ? price - prev : 0;
  const changePct = isFinite(prev) && prev ? (change / prev) * 100 : 0;
  const ts = Number(meta?.regularMarketTime) > 0 ? Number(meta?.regularMarketTime) * 1000 : Date.now();
  return {
    source: "yahoo", symbol: sym, price, change, changePct,
    volume: Number(meta?.regularMarketVolume ?? 0), ts,
  };
}

// ── Stooq (free, CSV; US tickers need .US suffix) ──
async function fetchStooq(symbol: string): Promise<SourceQuote | null> {
  const sym = symbol.toUpperCase();
  const stooqSym = `${sym.toLowerCase()}.us`;
  try {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSym)}&f=sd2t2ohlcv&h&e=csv`;
    const r = await fetchWithRetry(url);
    if (!r.ok) return null;
    const csv = await r.text();
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return null;
    const cols = lines[1].split(",");
    // Symbol,Date,Time,Open,High,Low,Close,Volume
    const open = Number(cols[3]);
    const close = Number(cols[6]);
    const volume = Number(cols[7]);
    if (!isFinite(close) || close <= 0) return null;
    const change = isFinite(open) ? close - open : 0;
    const changePct = isFinite(open) && open ? (change / open) * 100 : 0;
    const ts = Date.parse(`${cols[1]}T${cols[2]}Z`) || Date.now();
    return { source: "stooq", symbol: sym, price: close, change, changePct, volume, ts };
  } catch (e) {
    console.warn(`[stooq] ${sym}`, e);
    return null;
  }
}

// ── Finnhub (free tier — 60 req/min; needs FINNHUB_API_KEY) ──
function finnhubConfigured(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}

async function fetchFinnhub(symbol: string): Promise<SourceQuote | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const sym = symbol.toUpperCase();
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`;
    const r = await fetchWithRetry(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as { c?: number; d?: number; dp?: number; pc?: number; t?: number };
    const price = Number(j.c);
    if (!isFinite(price) || price <= 0) return null;
    const change = isFinite(Number(j.d)) ? Number(j.d) : 0;
    const changePct = isFinite(Number(j.dp)) ? Number(j.dp) : 0;
    const ts = Number(j.t) > 0 ? Number(j.t) * 1000 : Date.now();
    return { source: "finnhub", symbol: sym, price, change, changePct, volume: 0, ts };
  } catch (e) {
    console.warn(`[finnhub] ${sym}`, e);
    return null;
  }
}

function massiveAdapter(q: MassiveQuote): SourceQuote {
  return {
    source: "massive", symbol: q.symbol, price: q.price,
    change: q.change, changePct: q.changePct, volume: q.volume, ts: q.ts,
  };
}

function publicAdapter(q: PublicQuote): SourceQuote {
  return {
    source: "public", symbol: q.symbol, price: q.price,
    change: q.change, changePct: q.changePct, volume: 0, ts: q.ts,
  };
}

// ── CoinGecko (free, no key — crypto only) ──
// Public free tier: ~10–30 req/min from a given IP. We hit the simple-price
// endpoint which is the cheapest and serves USD price + 24h change in one call.
const COINGECKO_ID_MAP: Record<string, string> = {
  "BTC-USD": "bitcoin",
  "ETH-USD": "ethereum",
  "SOL-USD": "solana",
  "BNB-USD": "binancecoin",
  "XRP-USD": "ripple",
  "ADA-USD": "cardano",
  "DOGE-USD": "dogecoin",
  "AVAX-USD": "avalanche-2",
  "LINK-USD": "chainlink",
  "MATIC-USD": "matic-network",
  "DOT-USD": "polkadot",
  "LTC-USD": "litecoin",
};

function coingeckoId(symbol: string): string | null {
  const upper = symbol.toUpperCase();
  return COINGECKO_ID_MAP[upper] ?? null;
}

async function fetchCoinGecko(symbol: string): Promise<SourceQuote | null> {
  const id = coingeckoId(symbol);
  if (!id) return null;
  const sym = symbol.toUpperCase();
  try {
    const url =
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}` +
      `&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_last_updated_at=true`;
    const r = await fetchWithRetry(url, {
      headers: { Accept: "application/json", "User-Agent": "MomentumAI/1.0" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number; usd_24h_vol?: number; last_updated_at?: number }
    >;
    const row = j[id];
    const price = Number(row?.usd);
    if (!isFinite(price) || price <= 0) return null;
    const changePct = Number(row?.usd_24h_change ?? 0);
    const change = isFinite(changePct) ? price * (changePct / 100) : 0;
    const volume = Number(row?.usd_24h_vol ?? 0);
    const ts = Number(row?.last_updated_at) > 0 ? Number(row?.last_updated_at) * 1000 : Date.now();
    return { source: "coingecko", symbol: sym, price, change, changePct, volume, ts };
  } catch (e) {
    console.warn(`[coingecko] ${sym}`, e);
    return null;
  }
}

/**
 * Pull from every available source in parallel. Free sources (Yahoo, Stooq,
 * CoinGecko) are ALWAYS queried so we degrade gracefully when Massive is
 * disabled, cooling down, or returning errors. Massive is only attempted when
 * it is configured, enabled in Settings, and not currently rate-limited.
 */
async function fetchAllSources(symbol: string): Promise<SourceQuote[]> {
  // Crypto pairs (e.g. BTC-USD, SOL-USD) — query CoinGecko (primary, no key)
  // and Yahoo (fallback). Stooq/Finnhub/Massive don't carry crypto.
  const isCrypto = /-USD$/i.test(symbol);
  if (isCrypto) {
    const [cg, y] = await Promise.all([
      fetchCoinGecko(symbol).catch(() => null),
      fetchYahoo(symbol).catch(() => null),
    ]);
    return [cg, y].filter((q): q is SourceQuote => q !== null);
  }

  // Free fallbacks first — these never depend on Massive's state.
  const tasks: Array<Promise<SourceQuote | null>> = [
    fetchYahoo(symbol).catch(() => null),
    fetchStooq(symbol).catch(() => null),
  ];

  if (finnhubConfigured()) {
    tasks.push(fetchFinnhub(symbol).catch(() => null));
  }

  const massiveCooldown = getMassiveCooldownStatus();
  const massiveAvailable =
    massiveConfigured() && isMassiveEnabled() && !massiveCooldown.rateLimited;

  if (massiveAvailable) {
    tasks.push(
      fetchMassiveQuote(symbol)
        .then(q => (q ? massiveAdapter(q) : null))
        .catch(() => null), // never let Massive errors break consensus
    );
  }
  if (publicConfigured()) {
    tasks.push(fetchPublicQuote(symbol).then(q => (q ? publicAdapter(q) : null)).catch(() => null));
  }
  const out = await Promise.all(tasks);
  return out.filter((q): q is SourceQuote => q !== null);
}

// Tiered agreement thresholds (decimal fraction, not percent).
// Per spec: 0.75% large-cap/ETF, 1.5% mid-cap, 3% high-beta/crypto.
const LARGE_CAP = new Set([
  "SPY","QQQ","IWM","DIA","SMH","XLK","XLF","XLE","XLV","XLY","XLI","XLP","XLU","XLB","XLRE","XLC",
  "VOO","VTI","VEA","VWO","VXX","UVXY","TLT","HYG","LQD","GLD","SLV","USO",
  "AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA","AVGO","BRK.B","JPM","V","MA","UNH","XOM",
  "WMT","JNJ","PG","HD","COST","BAC","ORCL","CRM","ADBE","NFLX","AMD","INTC","CSCO","KO","PEP","ABBV",
]);

function thresholdFor(symbol: string): number {
  const s = symbol.toUpperCase();
  if (/-USD$/.test(s)) return 0.03;           // crypto: 3%
  if (LARGE_CAP.has(s)) return 0.0075;        // mega/ETF: 0.75%
  return 0.015;                                // default mid-cap: 1.5%
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Build a consensus quote.
 * Strategy:
 *   - Find the LARGEST cluster of sources whose prices agree within
 *     the per-ticker threshold (cross-validation).
 *   - The cluster's freshest source is the winner. Outliers are rejected
 *     so a stale/split-mangled provider can never poison the price.
 *   - If no two sources agree → agreement="mismatch" and we return the
 *     freshest single source, but the validator downstream will refuse
 *     to rank it.
 */
export function consensus(quotes: SourceQuote[]): ConsensusQuote | null {
  if (quotes.length === 0) return null;
  const sources: Partial<Record<SourceName, number>> = {};
  for (const q of quotes) sources[q.source] = q.price;

  if (quotes.length === 1) {
    const w = quotes[0];
    return {
      symbol: w.symbol, price: w.price, change: w.change, changePct: w.changePct,
      volume: w.volume, ts: w.ts, consensusSource: w.source, sources,
      agreement: "single", diffPct: null,
    };
  }

  const threshold = thresholdFor(quotes[0].symbol);

  // Find the largest cluster — pairs whose relative diff is within threshold.
  // O(n²) over a tiny n (≤6).
  let bestCluster: SourceQuote[] = [];
  for (let i = 0; i < quotes.length; i++) {
    const anchor = quotes[i];
    const cluster = quotes.filter(
      (q) => Math.abs(q.price - anchor.price) / anchor.price <= threshold,
    );
    if (cluster.length > bestCluster.length) bestCluster = cluster;
  }

  const prices = quotes.map((q) => q.price);
  const maxAll = Math.max(...prices);
  const minAll = Math.min(...prices);
  const refForDiff = median(prices);
  const diffPct = refForDiff > 0 ? ((maxAll - minAll) / refForDiff) * 100 : null;

  // 2+ agreeing sources → trust the cluster, reject the outliers.
  if (bestCluster.length >= 2) {
    const winner = [...bestCluster].sort((a, b) => b.ts - a.ts)[0];
    const clusterPrices = bestCluster.map((q) => q.price);
    const clusterDiff =
      winner.price > 0
        ? ((Math.max(...clusterPrices) - Math.min(...clusterPrices)) / winner.price) * 100
        : 0;
    const outliers = quotes.length - bestCluster.length;
    if (outliers > 0) {
      const rejected = quotes
        .filter((q) => !bestCluster.includes(q))
        .map((q) => `${q.source}=$${q.price.toFixed(2)}`)
        .join(", ");
      // eslint-disable-next-line no-console
      console.warn(
        `[consensus] ${winner.symbol}: rejected outlier(s) ${rejected} — cluster $${winner.price.toFixed(2)} (${bestCluster.length}/${quotes.length} agree within ${(threshold * 100).toFixed(2)}%)`,
      );
    }
    const agreement: ConsensusQuote["agreement"] =
      clusterDiff < (threshold * 100) / 3 ? "verified" : "close";
    return {
      symbol: winner.symbol, price: winner.price, change: winner.change,
      changePct: winner.changePct, volume: winner.volume, ts: winner.ts,
      consensusSource: winner.source, sources, agreement, diffPct,
    };
  }

  // No agreeing cluster — providers disagree. Return freshest but flag mismatch.
  const freshest = [...quotes].sort((a, b) => b.ts - a.ts)[0];
  // eslint-disable-next-line no-console
  console.warn(
    `[consensus] ${freshest.symbol}: MISMATCH — sources disagree (Δ ${diffPct?.toFixed(2)}% > ${(threshold * 100).toFixed(2)}%): ${quotes.map((q) => `${q.source}=$${q.price.toFixed(2)}`).join(", ")}`,
  );
  return {
    symbol: freshest.symbol, price: freshest.price, change: freshest.change,
    changePct: freshest.changePct, volume: freshest.volume, ts: freshest.ts,
    consensusSource: freshest.source, sources,
    agreement: "mismatch", diffPct,
  };
}

export async function getConsensusQuote(symbol: string): Promise<ConsensusQuote | null> {
  const sources = await fetchAllSources(symbol);
  return consensus(sources);
}

export async function getConsensusQuotes(symbols: string[]): Promise<Record<string, ConsensusQuote | null>> {
  const out: Record<string, ConsensusQuote | null> = {};
  const unique = normalizeTickers(symbols, 50);
  for (const s of unique) out[s] = await getConsensusQuote(s);
  return out;
}

// ── Per-provider health probe (used by Settings status panel) ──
export interface ProviderHealth {
  source: SourceName;
  configured: boolean;
  ok: boolean;
  latencyMs: number | null;
  records: number;
  note: string;
  error?: string;
  rateLimited?: boolean;
  retryInMs?: number;
}

const PROBE_TIMEOUT_MS = 2_500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); },
           (e) => { clearTimeout(t); reject(e); });
  });
}

async function probe(
  source: SourceName,
  fn: () => Promise<SourceQuote | null>,
  configured: boolean,
  note: string,
  cooldown?: { rateLimited: boolean; remainingMs: number },
): Promise<ProviderHealth> {
  if (!configured) return { source, configured: false, ok: false, latencyMs: null, records: 0, note };
  if (cooldown?.rateLimited) {
    return {
      source, configured: true, ok: false, latencyMs: null, records: 0, note,
      rateLimited: true, retryInMs: cooldown.remainingMs,
      error: `Rate-limited — retry in ${Math.ceil(cooldown.remainingMs / 1000)}s`,
    };
  }
  const start = Date.now();
  try {
    const q = await withTimeout(fn(), PROBE_TIMEOUT_MS);
    const latencyMs = Date.now() - start;
    return { source, configured: true, ok: Boolean(q), latencyMs, records: q ? 1 : 0, note };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const rateLimited = (e as { rateLimited?: boolean })?.rateLimited === true;
    return {
      source, configured: true, ok: false, latencyMs: Date.now() - start,
      records: 0, note, error: msg, rateLimited,
      retryInMs: rateLimited ? (e as { retryAfterMs?: number }).retryAfterMs : undefined,
    };
  }
}


export async function probeAllProviders(): Promise<ProviderHealth[]> {
  return Promise.all([
    probe("massive", () => fetchMassiveQuote("SPY").then(q => q ? massiveAdapter(q) : null),
      massiveConfigured(), "Real-time quotes — MASSIVE_API_KEY", getMassiveCooldownStatus()),
    probe("public", () => fetchPublicQuote("SPY").then(q => q ? publicAdapter(q) : null),
      publicConfigured(), "Brokerage quotes — PUBLIC_COM_API_KEY", getPublicCooldownStatus()),
    probe("finnhub", () => fetchFinnhub("SPY"), finnhubConfigured(), "Real-time quotes — FINNHUB_API_KEY"),
    probe("yahoo", () => fetchYahoo("SPY"), true, "Quotes feed — free, no key required"),
    probe("stooq", () => fetchStooq("SPY"), true, "EOD quotes — free, no key required"),
    probe("coingecko", () => fetchCoinGecko("BTC-USD"), true, "Crypto quotes — free, no key required"),
  ]);
}
