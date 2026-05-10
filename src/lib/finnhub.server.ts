/** Server-only Finnhub helpers. */

const BASE = "https://finnhub.io/api/v1";

function key(): string | null {
  return process.env.FINNHUB_API_KEY ?? null;
}

export function finnhubConfigured(): boolean {
  return !!key();
}

// ----- Symbol normalization -----

/**
 * Normalize a user/feed-supplied ticker into Finnhub's canonical form.
 * Finnhub is case-sensitive (always uppercase) and uses dots — not slashes
 * or dashes — for share-class suffixes (BRK.B, BF.B, RDS.A). Some upstream
 * feeds emit "BRK/B" or "brk-b" instead.
 *
 * Returns an ordered list of candidates to try in sequence. The first that
 * resolves wins; later entries are fallbacks for tickers whose canonical
 * separator is ambiguous across vendors.
 */
export function finnhubSymbolCandidates(input: string): string[] {
  const raw = (input ?? "").trim().toUpperCase();
  if (!raw) return [];
  // Strip whitespace and any wrapping quotes.
  const cleaned = raw.replace(/[\s"']+/g, "");
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };
  // Primary: dots are Finnhub's canonical share-class separator.
  push(cleaned.replace(/[/\\-]/g, "."));
  // Fallback 1: hyphen form (Yahoo style: BRK-B).
  push(cleaned.replace(/[/\\.]/g, "-"));
  // Fallback 2: bare form (no separator at all).
  push(cleaned.replace(/[/\\.\-]/g, ""));
  // Fallback 3: original cleaned input as-is.
  push(cleaned);
  return out;
}

/** Public alias for callers that just want the canonical form. */
export function normalizeFinnhubSymbol(input: string): string {
  return finnhubSymbolCandidates(input)[0] ?? "";
}

// ----- Live quote (used as fallback when primary provider fails / 429s) -----

export interface FinnhubQuote {
  /** Current price */
  c: number;
  /** Change */
  d: number;
  /** Percent change */
  dp: number;
  /** High of day */
  h: number;
  /** Low of day */
  l: number;
  /** Open of day */
  o: number;
  /** Previous close */
  pc: number;
  /** Unix seconds */
  t: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch a single Finnhub quote URL with bounded exponential-backoff retry.
 * Returns the parsed quote, `"unknown-symbol"` when Finnhub responds OK but
 * the ticker has no data (`c === 0`), or `null` for auth/network failure.
 */
async function fetchOneFinnhubQuote(
  symbol: string,
  apiKey: string,
): Promise<FinnhubQuote | null | "unknown-symbol"> {
  const url = `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const j = (await res.json()) as Partial<FinnhubQuote>;
        if (!j || typeof j.c !== "number" || j.c <= 0) return "unknown-symbol";
        return {
          c: j.c,
          d: typeof j.d === "number" ? j.d : 0,
          dp: typeof j.dp === "number" ? j.dp : 0,
          h: typeof j.h === "number" ? j.h : 0,
          l: typeof j.l === "number" ? j.l : 0,
          o: typeof j.o === "number" ? j.o : 0,
          pc: typeof j.pc === "number" ? j.pc : 0,
          t: typeof j.t === "number" ? j.t : Math.floor(Date.now() / 1000),
        };
      }
      // Don't retry auth failures — the key is wrong / lacks the endpoint.
      if (res.status === 401 || res.status === 403) return null;
      if (!RETRYABLE_STATUS.has(res.status) || attempt === maxAttempts) {
        console.warn("finnhub quote", symbol, res.status);
        return null;
      }
      // Honor Retry-After when present, else exponential backoff with jitter.
      const ra = Number(res.headers.get("retry-after"));
      const backoff = isFinite(ra) && ra > 0
        ? Math.min(ra * 1000, 5_000)
        : Math.min(250 * 2 ** (attempt - 1), 2_000) + Math.random() * 150;
      await sleep(backoff);
    } catch (e) {
      if (attempt === maxAttempts) {
        console.warn("finnhub quote failed", symbol, e);
        return null;
      }
      await sleep(Math.min(250 * 2 ** (attempt - 1), 2_000));
    }
  }
  return null;
}

/**
 * Fetch a live stock quote with symbol normalization + retry. Tries the
 * canonical Finnhub form first (e.g. "BRK.B"), then hyphen ("BRK-B") and
 * bare ("BRKB") variants for tickers that arrive from upstream feeds in a
 * different shape. Returns null when none of the variants resolve.
 *
 * Never throws — caller treats null as "fallback unavailable".
 */
export async function fetchFinnhubQuote(symbol: string): Promise<FinnhubQuote | null> {
  const k = key();
  if (!k) return null;
  const candidates = finnhubSymbolCandidates(symbol);
  if (candidates.length === 0) return null;
  for (const candidate of candidates) {
    const result = await fetchOneFinnhubQuote(candidate, k);
    if (result && result !== "unknown-symbol") return result;
    // For "unknown-symbol", fall through to the next candidate variant.
    // For null (auth/network failure on first try), keep trying variants too —
    // a transient failure shouldn't poison the whole fallback chain.
  }
  return null;
}


// ----- Earnings calendar -----

export interface FinnhubEarningsEvent {
  symbol: string;
  /** YYYY-MM-DD report date */
  date: string;
  /** "bmo" | "amc" | "dmh" | "" */
  hour: string;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  year: number | null;
  quarter: number | null;
}

interface RawEarningsRow {
  symbol?: string;
  date?: string;
  hour?: string;
  epsEstimate?: number | null;
  epsActual?: number | null;
  revenueEstimate?: number | null;
  revenueActual?: number | null;
  year?: number;
  quarter?: number;
}

/**
 * Fetch earnings calendar for symbol within [today, today+daysAhead].
 * Returns [] when unconfigured / unauthorized / no events. Never throws.
 */
export async function fetchEarningsCalendar(
  symbol: string,
  daysAhead = 60,
): Promise<FinnhubEarningsEvent[]> {
  const k = key();
  if (!k) return [];
  const today = new Date();
  const to = new Date(today.getTime() + daysAhead * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `${BASE}/calendar/earnings?symbol=${encodeURIComponent(symbol)}&from=${fmt(today)}&to=${fmt(to)}&token=${k}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status !== 401 && res.status !== 403) {
        console.warn("finnhub earnings", symbol, res.status);
      }
      return [];
    }
    const json = (await res.json()) as { earningsCalendar?: RawEarningsRow[] };
    const rows = Array.isArray(json?.earningsCalendar) ? json.earningsCalendar : [];
    return rows
      .filter((r): r is RawEarningsRow & { symbol: string; date: string } => !!r?.symbol && !!r?.date)
      .map((r) => ({
        symbol: r.symbol.toUpperCase(),
        date: r.date,
        hour: r.hour ?? "",
        epsEstimate: r.epsEstimate ?? null,
        epsActual: r.epsActual ?? null,
        revenueEstimate: r.revenueEstimate ?? null,
        revenueActual: r.revenueActual ?? null,
        year: r.year ?? null,
        quarter: r.quarter ?? null,
      }));
  } catch (e) {
    console.warn("finnhub earnings failed", symbol, e);
    return [];
  }
}

export interface FinnhubNewsItem {
  category: string;
  datetime: number; // unix seconds
  headline: string;
  id: number;
  image?: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

/** Recent company news (Finnhub returns last ~7 days when no range given). */
export async function fetchCompanyNews(
  symbol: string,
  daysBack = 7,
): Promise<FinnhubNewsItem[]> {
  const k = key();
  if (!k) return [];
  const to = new Date();
  const from = new Date(to.getTime() - daysBack * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `${BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${k}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("finnhub company-news", symbol, res.status);
      return [];
    }
    const json = (await res.json()) as FinnhubNewsItem[];
    return Array.isArray(json) ? json : [];
  } catch (e) {
    console.error("finnhub company-news failed", symbol, e);
    return [];
  }
}

// ----- Option chain (used as secondary source for contract verification) -----

export interface FinnhubOptionRow {
  strike: number;
  bid: number;
  ask: number;
  lastPrice: number;
  volume: number;
  openInterest: number;
  iv: number;            // 0-1
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  contractName: string;
}

export interface FinnhubExpirationBlock {
  expirationDate: string; // YYYY-MM-DD
  calls: FinnhubOptionRow[];
  puts: FinnhubOptionRow[];
}

interface RawOptionChainRow {
  strike?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  contractName?: string;
}

interface RawOptionChainBlock {
  expirationDate?: string;
  options?: { CALL?: RawOptionChainRow[]; PUT?: RawOptionChainRow[] };
}

interface RawOptionChainResponse {
  data?: RawOptionChainBlock[];
}

const num = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : NaN);

function normalizeRow(r: RawOptionChainRow): FinnhubOptionRow {
  return {
    strike: num(r.strike),
    bid: num(r.bid),
    ask: num(r.ask),
    lastPrice: num(r.lastPrice),
    volume: num(r.volume),
    openInterest: num(r.openInterest),
    iv: num(r.impliedVolatility),
    delta: num(r.delta),
    gamma: num(r.gamma),
    theta: num(r.theta),
    vega: num(r.vega),
    contractName: r.contractName ?? "",
  };
}

/**
 * Fetch the full option chain. Returns [] if Finnhub is unconfigured,
 * the symbol has no options, or the response is unauthorized (free-tier
 * plans typically lack option-chain access — caller treats [] as
 * "secondary unavailable" rather than a hard error).
 */
export async function fetchFinnhubOptionChain(
  symbol: string,
): Promise<FinnhubExpirationBlock[]> {
  const k = key();
  if (!k) return [];
  const url = `${BASE}/stock/option-chain?symbol=${encodeURIComponent(symbol)}&token=${k}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 401/403 = plan doesn't include option-chain. Don't spam logs.
      if (res.status !== 401 && res.status !== 403) {
        console.warn("finnhub option-chain", symbol, res.status);
      }
      return [];
    }
    const json = (await res.json()) as RawOptionChainResponse;
    const blocks = Array.isArray(json?.data) ? json.data : [];
    return blocks
      .filter((b): b is RawOptionChainBlock & { expirationDate: string } => !!b?.expirationDate)
      .map((b) => ({
        expirationDate: b.expirationDate,
        calls: (b.options?.CALL ?? []).map(normalizeRow),
        puts: (b.options?.PUT ?? []).map(normalizeRow),
      }));
  } catch (e) {
    console.warn("finnhub option-chain failed", symbol, e);
    return [];
  }
}
