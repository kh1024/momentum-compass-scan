export type UniverseGroup = "MEGA_LARGE" | "ETFS" | "MID_MOMENTUM" | "YOLO_REDDIT";

/**
 * Broad large/mid-cap universe organized into four toggle groups.
 * Edit any list freely — additions are picked up automatically by the scanner.
 *
 * Coverage (by group):
 *   MEGA_LARGE   — mega-cap tech, semiconductors, banks, energy, healthcare,
 *                  industrials, consumer, retail, communications, payments
 *   ETFS         — major broad-market & sector ETFs
 *   MID_MOMENTUM — software, cybersecurity, AI infra, fintech, biotech,
 *                  high-beta growth & momentum mid-caps
 *   YOLO_REDDIT  — crypto-linked equities, meme/lottery names, speculative
 *                  high-beta tickers favored by retail communities
 */
export const UNIVERSE_GROUPS: Record<UniverseGroup, { label: string; tickers: string[] }> = {
  MEGA_LARGE: {
    label: "Mega / Large Cap",
    tickers: [
      // Mega-cap tech
      "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "NFLX",
      // Semiconductors
      "AMD", "AVGO", "QCOM", "MU", "ARM", "TSM", "ASML", "INTC", "MRVL",
      "LRCX", "AMAT", "KLAC",
      // Enterprise software / cloud
      "ORCL", "CRM", "ADBE", "NOW", "IBM", "SAP",
      // Banks / financials
      "JPM", "BAC", "GS", "MS", "C", "WFC", "BLK", "SCHW", "AXP",
      // Payments
      "V", "MA", "PYPL",
      // Energy
      "XOM", "CVX", "OXY", "SLB", "HAL", "COP", "EOG",
      // Healthcare / pharma / biotech leaders
      "LLY", "UNH", "JNJ", "ABBV", "MRK", "PFE", "MRNA", "GILD", "REGN",
      "VRTX", "AMGN", "BMY",
      // Industrials / defense
      "BA", "CAT", "DE", "GE", "RTX", "LMT", "NOC", "HON", "UNP",
      // Consumer / retail
      "WMT", "COST", "TGT", "HD", "LOW", "NKE", "SBUX", "MCD", "KO", "PEP",
      "PG", "CL",
      // Communications / media
      "DIS", "T", "VZ", "CMCSA",
    ],
  },
  ETFS: {
    label: "Major ETFs",
    tickers: [
      // Broad market
      "SPY", "QQQ", "IWM", "DIA",
      // Sector
      "XLK", "XLF", "XLE", "XLV", "XLY", "XLI", "XLP", "XLU", "XLB", "XLC",
      // Industry / thematic
      "SMH", "SOXX", "XBI", "IBB", "ARKK", "KRE", "XOP", "GDX", "TLT", "HYG",
    ],
  },
  MID_MOMENTUM: {
    label: "Mid-Cap Momentum",
    tickers: [
      // AI infrastructure
      "PLTR", "SMCI", "SNOW", "MDB", "DDOG", "NET", "AI", "PATH",
      // Cybersecurity
      "CRWD", "PANW", "ZS", "S", "OKTA", "FTNT",
      // Software / SaaS
      "SHOP", "SQ", "U", "TEAM", "WDAY", "DOCU", "TWLO", "ZM", "HUBS",
      // Fintech / consumer finance
      "SOFI", "AFRM", "HOOD", "UPST", "LC",
      // Mobility / gig
      "UBER", "LYFT", "DASH", "ABNB",
      // Gaming / interactive
      "RBLX", "TTD", "ROKU",
      // EV / clean energy
      "RIVN", "LCID", "F", "GM", "ENPH", "FSLR", "PLUG",
      // Travel / leisure
      "BKNG", "DKNG",
      // Quantum / next-gen
      "IONQ", "RKLB", "ACHR", "JOBY",
      // International momentum
      "MELI", "SE", "BABA", "PDD", "JD", "NIO",
      // Biotech mid-caps
      "BIIB", "ILMN", "CRSP", "NTLA",
    ],
  },
  YOLO_REDDIT: {
    label: "YOLO / Speculative",
    tickers: [
      // Meme / lottery
      "GME", "AMC", "BBBY", "BB", "NOK",
      // Crypto-linked equities
      "COIN", "MSTR", "MARA", "RIOT", "CLSK", "IREN", "WULF", "HUT", "BITF",
      // High-beta speculative
      "ASTS", "OKLO", "QS", "OPEN", "HIMS", "CVNA", "TLRY", "SOUN", "BBAI",
      "RGTI", "QBTS", "LUNR", "RKLB",
      // Re-org / turnaround beta
      "WBA", "PARA", "WBD",
    ],
  },
};

export const ALL_GROUPS = Object.keys(UNIVERSE_GROUPS) as UniverseGroup[];

const storageKey = (g: UniverseGroup) => `scanner.universe.${g}`;

export function loadGroupEnabled(group: UniverseGroup): boolean {
  if (typeof window === "undefined") return true;
  const v = localStorage.getItem(storageKey(group));
  return v === null ? true : v === "1";
}

export function saveGroupEnabled(group: UniverseGroup, enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(group), enabled ? "1" : "0");
}

export function getActiveUniverse(enabled: Record<UniverseGroup, boolean>): string[] {
  const out: string[] = [];
  for (const g of ALL_GROUPS) {
    if (enabled[g]) out.push(...UNIVERSE_GROUPS[g].tickers);
  }
  return Array.from(new Set(out));
}
