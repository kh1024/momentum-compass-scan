/**
 * Multi-source quote provider — server-only.
 * Aggregates Massive (keyed) + Yahoo + Stooq (free, no key).
 * Consensus rule: freshest timestamp wins. Cross-checked across sources.
 */

import { fetchMassiveQuote, massiveConfigured, getMassiveCooldownStatus, isMassiveEnabled, type MassiveQuote } from "./massive.server";
import { fetchPublicQuote, publicConfigured, getPublicCooldownStatus, type PublicQuote } from "./publicCom.server";
import { fetchWithRetry } from "./fetchRetry.server";
import { normalizeTickers } from "./scannerQueue";

export type SourceName = "massive" | "public" | "finnhub" | "yahoo" | "stooq";

export interface SourceQuote {
  source: SourceName;
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  ts: number; // epoch ms
}

export interface ConsensusQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  ts: number;
  consensusSource: SourceName;
  sources: Partial<Record<SourceName, number>>; // price per source
  agreement: "verified" | "close" | "mismatch" | "single";
  diffPct: number | null;
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

// ── Yahoo (free, chart endpoint — requires crumb + cookie since 2024) ──
async function fetchYahoo(symbol: string): Promise<SourceQuote | null> {
  const sym = symbol.toUpperCase();
  const doFetch = async (session: { crumb: string; cookie: string } | null) => {
    const qs = `interval=1d&range=5d${session?.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : ""}`;
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${qs}`;
    const headers: Record<string, string> = { "User-Agent": YAHOO_UA, Accept: "application/json" };
    if (session?.cookie) headers["Cookie"] = session.cookie;
    return fetchWithRetry(url, { headers });
  };
  try {
    let session = await getYahooCrumb();
    let r = await doFetch(session);
    if (r.status === 401 || r.status === 403) {
      // Stale crumb — invalidate and retry once with a fresh session.
      yahooCrumbCache = null;
      session = await getYahooCrumb(true);
      r = await doFetch(session);
    }
    if (!r.ok) return null;
    return parseYahooChart(await r.json(), sym);
  } catch (e) {
    console.warn(`[yahoo] ${sym}`, e);
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

/**
 * Pull from every available source in parallel. Free sources (Yahoo, Stooq)
 * are ALWAYS queried so we degrade gracefully when Massive is disabled,
 * cooling down, or returning errors. Massive is only attempted when it is
 * configured, enabled in Settings, and not currently rate-limited.
 */
async function fetchAllSources(symbol: string): Promise<SourceQuote[]> {
  // Free fallbacks first — these never depend on Massive's state.
  const tasks: Array<Promise<SourceQuote | null>> = [
    fetchYahoo(symbol).catch(() => null),
    fetchStooq(symbol).catch(() => null),
  ];

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

/** Build a consensus quote from one symbol's source list. Freshest ts wins. */
export function consensus(quotes: SourceQuote[]): ConsensusQuote | null {
  if (quotes.length === 0) return null;
  const sorted = [...quotes].sort((a, b) => b.ts - a.ts);
  const winner = sorted[0];
  const sources: Partial<Record<SourceName, number>> = {};
  for (const q of quotes) sources[q.source] = q.price;

  let agreement: ConsensusQuote["agreement"] = "single";
  let diffPct: number | null = null;
  if (quotes.length >= 2) {
    const prices = quotes.map(q => q.price);
    const max = Math.max(...prices);
    const min = Math.min(...prices);
    diffPct = ((max - min) / winner.price) * 100;
    agreement = diffPct < 0.25 ? "verified" : diffPct < 1 ? "close" : "mismatch";
  }

  return {
    symbol: winner.symbol,
    price: winner.price,
    change: winner.change,
    changePct: winner.changePct,
    volume: winner.volume,
    ts: winner.ts,
    consensusSource: winner.source,
    sources,
    agreement,
    diffPct,
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
    const q = await fn();
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
    probe("yahoo", () => fetchYahoo("SPY"), true, "Quotes feed — free, no key required"),
    probe("stooq", () => fetchStooq("SPY"), true, "EOD quotes — free, no key required"),
  ]);
}
