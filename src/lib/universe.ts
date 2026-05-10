export type UniverseGroup = "MEGA_LARGE" | "ETFS" | "MID_MOMENTUM" | "YOLO_REDDIT";

export const UNIVERSE_GROUPS: Record<UniverseGroup, { label: string; tickers: string[] }> = {
  MEGA_LARGE: {
    label: "Mega/Large",
    tickers: [
      "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA",
      "AVGO", "AMD", "NFLX", "CRM", "ORCL", "ADBE", "QCOM",
    ],
  },
  ETFS: {
    label: "ETFs",
    tickers: ["SPY", "QQQ", "IWM", "GLD", "XLK", "SMH", "TLT", "XLE", "XLF", "XBI"],
  },
  MID_MOMENTUM: {
    label: "Mid Momentum",
    tickers: [
      "PLTR", "COIN", "SMCI", "CRWD", "SNOW", "DDOG", "NET",
      "MSTR", "HOOD", "RIVN", "SOFI", "RBLX", "UBER", "LYFT", "ABNB",
    ],
  },
  YOLO_REDDIT: {
    label: "YOLO/Reddit",
    tickers: ["GME", "AMC", "BB", "MARA", "RIOT", "CLSK", "HIMS"],
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
