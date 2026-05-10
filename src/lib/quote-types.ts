export type SourceName = "massive" | "public" | "finnhub" | "yahoo" | "stooq" | "coingecko";

export interface ConsensusQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  ts: number;
  consensusSource: SourceName;
  sources: Partial<Record<SourceName, number>>;
  agreement: "verified" | "close" | "mismatch" | "single";
  diffPct: number | null;
}
