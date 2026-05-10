// Shared quote types — safe to import from both client and server.
export type SourceName = "yahoo" | "stooq" | "finnhub" | "twelvedata" | "polygon" | "alphaVantage" | string;

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
