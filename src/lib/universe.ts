export type UniverseGroup = "MEGA_LARGE" | "ETFS" | "MID_MOMENTUM" | "YOLO_REDDIT";

export const UNIVERSE_GROUPS: Record<UniverseGroup, { label: string; tickers: string[] }> = {
  MEGA_LARGE: {
    label: "Mega/Large",
    tickers: [
      "NVDA", "MSFT", "AAPL", "AMZN", "META", "GOOGL", "TSLA",
      "AMD", "AVGO", "NFLX", "COST", "CRM", "ORCL", "QCOM",
      "MU", "ARM", "ASML", "TSM",
    ],
  },
  ETFS: {
    label: "ETFs",
    tickers: ["SPY", "QQQ", "IWM", "SMH", "SOXX", "XLE", "XLF", "XLK", "XBI", "ARKK"],
  },
  MID_MOMENTUM: {
    label: "Mid Momentum",
    tickers: [
      "PLTR", "COIN", "HOOD", "RBLX", "SOFI", "UBER", "SHOP",
      "NET", "DDOG", "CRWD", "SNOW", "AFRM", "UPST", "IONQ", "RKLB", "SMCI",
    ],
  },
  YOLO_REDDIT: {
    label: "YOLO/Reddit",
    tickers: [
      "GME", "RIVN", "LCID", "MARA", "RIOT", "IREN", "WULF",
      "ACHR", "JOBY", "OPEN", "HIMS", "ASTS", "OKLO", "QS",
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
