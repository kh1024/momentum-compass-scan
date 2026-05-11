export type Direction = "CALL" | "PUT";
export type CapBucket = "Mega" | "Large" | "Mid" | "Small";
export type Label =
  | "Buy Now"
  | "Watchlist"
  | "Waiting on Trigger"
  | "Aggressive"
  | "Lotto"
  | "Near Miss"
  | "Find Better Strike"
  | "Avoid Contract"
  | "Avoid Ticker"
  /** Legacy alias — emitted by older code paths and translated by the discipline gate. */
  | "Avoid";
export type SetupType =
  | "Pullback-to-Support"
  | "Pivot/Base Breakout"
  | "Pivot/Base Retest"
  | "Short-Term Momentum"
  | "Reddit YOLO"
  | "LEAPS"
  | "Failed Breakout"
  | "Resistance Rejection"
  | "Breakdown";
export type Sentiment = "Bullish" | "Mixed" | "Bearish" | "Hype-only" | "None";
export type RegimeBias = "Risk-on" | "Mixed" | "Risk-off";
export type ScannerBias = "Calls favored" | "Puts favored" | "Trigger-only" | "No clean trades";

/**
 * Source of the contract's strike/expiration/greeks:
 *  - "chain"          → Real listed contract pulled from an options-chain endpoint.
 *  - "mock-seed"      → Original demo seed (never traded — always BCR).
 *  - "mock-rescaled"  → Demo seed whose underlying was rescaled by a live quote.
 *                       Strike is NOT rescaled, but greeks are still demo, so BCR.
 */
export type ContractSource = "chain" | "mock-seed" | "mock-rescaled";

/** Entry-mode classification for setup → strike-selection mapping. */
export type EntryMode =
  | "Support Reclaim"
  | "Breakout"
  | "Retest"
  | "Momentum"
  | "Lotto";

/** Live status of the entry trigger vs current price. */
export type TriggerStatus =
  | "active"          // trigger fired, breakout/reclaim confirmed
  | "not-active"      // waiting — price below breakout / above breakdown
  | "failed"          // breakout reversed
  | "stale"           // level is too far from the current price to compare cleanly
  | "waiting-retest"; // breakout fired then pulled back, awaiting retest hold

export type FinalTriggerUsed = "support reclaim" | "breakout" | "retest" | "momentum";

export interface EntryTriggerDetail {
  level: number;
  status: TriggerStatus;
}

export type PriceBasis = "ask" | "mid" | "last" | "unknown";
export type CostValidationStatus = "valid ask cost" | "valid mid cost" | "valid last cost" | "mismatch" | "unknown";
export type ExpirationComparisonStatus = "match" | "not-comparable" | "unknown";

export interface ExpirationComparison {
  appExpiration: string;
  appDte: number;
  appBucket: ExpirationBucket;
  brokerExpiration?: string;
  brokerDte?: number;
  status: ExpirationComparisonStatus;
  warning?: string;
}

/** Expiration bucket per scanner discipline rules. */
export type ExpirationBucket =
  | "weekly-lotto"      // 0–6 DTE
  | "lotto-aggressive"  // 7–13 DTE
  | "short-term-swing"  // 14–30 DTE
  | "extended-swing"    // 31–45 DTE
  | "swing-plus"        // 46–60 DTE
  | "leaps"             // 180–730 DTE
  | "excluded";         // 61–179 DTE or other

export interface OptionContract {
  expiration: string;
  strike: number;
  ask: number;
  bid: number;
  cost: number;
  iv: number; // 0-1
  delta: number;
  theta: number;
  thetaBurnPct: number;
  gamma: number;
  vega: number;
  volume: number;
  openInterest: number;
  spreadPct: number;
  dte: number;
  breakeven: number;
  breakevenMovePct: number;
  /** Where the contract data came from. Defaults to "mock-seed" if absent. */
  source?: ContractSource;
  /** True when the contract cannot be safely traded without manual broker check. */
  brokerConfirmRequired?: boolean;
  /** List of required fields that are missing or invalid on this contract. */
  missingFields?: string[];
  /** Cross-source verification (set when enrichment ran). */
  verification?: import("./contractVerify.types").ContractVerification;
  /** Last traded price (when the chain provider exposes it). */
  last?: number;
  /** Mid price = (bid+ask)/2. Pre-computed by chain mappers. */
  mid?: number;
  /** Which option price the displayed `cost` is based on. */
  priceBasis?: PriceBasis;
  /** Explicit cost math status for Buy Now gating and display. */
  costValidationStatus?: CostValidationStatus;
  /** Nearby real-chain strikes from the SAME expiration, for compare panel. */
  alternatives?: ContractAlternative[];
  /** Massive Options Data Quality result — set when chain enrichment ran. */
  dataQuality?: import("./optionDataQuality").DataQualityResult;
  /** OCC option ticker (e.g. O:NVDA260619C00200000) when known. */
  occSymbol?: string;
  /** Contract Repair / Better-Strike Search report — set when chain enrichment ran. */
  contractRepair?: import("./contractRepair").ContractRepairReport;
  /** Moneyness + style classification — set when chain enrichment ran. */
  classification?: import("./contractClassification").ContractClassification;
}

/** A neighbour real-chain strike used by the compare panel. */
export interface ContractAlternative {
  strike: number;
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  theta: number;
  iv: number;
  volume: number;
  openInterest: number;
  spreadPct: number;
  breakeven: number;
  /** Heuristic tag for the UI: how this strike relates to current price/trigger. */
  tag: "too-itm" | "best-balanced" | "breakout-only" | "too-far-otm" | "in-zone";
}

export interface Levels {
  s1: number; s2: number; s3: number;
  r1: number; r2: number; r3: number;
  pivot: number;
  baseHigh: number; baseLow: number; baseMid: number;
  dma20: number; dma50: number; dma200: number;
  vwap?: number;
}

export interface TradeCandidate {
  id: string;
  ticker: string;
  direction: Direction;
  price: number;
  cap: CapBucket;
  setupType: SetupType;
  score: number;
  label: Label;
  trend: string;
  sectorConfirmation: string;
  redditSentiment: Sentiment;
  redditMentionTrend?: "Rising" | "Flat" | "Falling";
  levels: Levels;
  entryTrigger: string;
  invalidation: string;
  target1: number;
  target2: number;
  contract: OptionContract;
  entryStrategy: string;
  exitStrategy: string;
  profitPlan: string;
  sizing: string;
  keyRisks: string[];
  /** Resolved entry mode for this candidate (mapped from setupType). */
  entryMode?: EntryMode;
  /** Live trigger status (price vs breakout/reclaim level). */
  triggerStatus?: TriggerStatus;
  /** Numeric breakout/reclaim trigger price the scanner is watching. */
  breakoutTrigger?: number;
  supportReclaimTrigger?: EntryTriggerDetail;
  breakoutTriggerState?: EntryTriggerDetail;
  retestTrigger?: EntryTriggerDetail;
  selectedContractMode?: EntryMode;
  selectedContractFitsEntryMode?: boolean;
  finalTriggerUsedForLabel?: FinalTriggerUsed;
  buyNowEligible?: boolean;
  buyNowBlockers?: string[];
  expirationComparison?: ExpirationComparison;
  /** Discipline penalties applied to the raw score (negative numbers). */
  scorePenalties?: { reason: string; delta: number }[];
  /** Pre-penalty composite setup score (0–100). */
  setupScore?: number;
  /** Contract Quality Score 0–35 (Greeks/IV/spread/OI/volume). */
  contractQualityScore?: number;
  /** Sub-points {delta,theta,iv,spread,oi,volume}. */
  contractQualityParts?: { delta: number; theta: number; iv: number; spread: number; oi: number; volume: number };
  /** Hard blockers from Contract Quality (each blocks Buy Now). */
  contractBlockers?: string[];
  /** Soft downgrades from Contract Quality. */
  contractDowngrades?: string[];
  /** Contract Quality tier — caps label. */
  contractTier?: "buyNowEligible" | "watchlistOnly" | "yoloOnly" | "avoid";
  /** Sum of all validation penalties (negative or 0). */
  validationPenalty?: number;
  /** Post-penalty tradable score (mirror of `score`, named explicitly). */
  finalScore?: number;
  /** Label produced by the scoring engine before discipline gating. */
  originalLabel?: Label;
  /** Routing decision for which scanner section the pick belongs to. */
  sectionRouted?: ExpirationBucket;
  /** Bucket label for display. */
  dteBucketLabel?: ExpirationBucket;
  /** Validation pass/fail flag (false when penalties or hard rules excluded it). */
  validationOk?: boolean;
  /** Human-readable reason for current label (why it passed/failed). */
  validationReason?: string;
  /**
   * Set when the chain provider returned a successful response but no
   * contract on the chain satisfied the active preference filters
   * (cost / moneyness / spread / liquidity). The ticker idea is still
   * worth watching but no tradable option exists right now.
   */
  noQualityContract?: boolean;
  /** Concise reason for noQualityContract (e.g. "wide spread", "premium > $500"). */
  noQualityReason?: string;
  brokerConfirmRequired: boolean;
  isDemo: boolean;
  /** UI hint: "live" current poll, "stale" sticky last-good, "demo" never seen live. */
  liveState?: "live" | "stale" | "demo";
  /** Quote validation result — see quoteValidation.ts. */
  quoteValidation?: import("./quoteValidation").QuoteValidation;
  /** Raw multi-source consensus snapshot — drives "Quote source" drawer section. */
  consensusQuote?: {
    sources: Partial<Record<string, number>>;
    consensusSource: string;
    agreement: "verified" | "close" | "mismatch" | "single";
    diffPct: number | null;
    ts: number;
  };
  // YOLO extras
  whyExplode?: string;
  whyZero?: string;
  yoloScore?: number;
  // LEAPS extras
  thesis?: string;
  monthlyReview?: string;
}

export interface AvoidEntry {
  ticker: string;
  reason: string;
  details: string;
}

export interface PatternHit {
  ticker: string;
  pattern: string;
  bias: "Bullish" | "Bearish";
  confidence: number; // 0-100
  trigger: number;
  target: number;
  isDemo: boolean;
}

export interface BreakoutAlert {
  ticker: string;
  window: 5 | 10;
  price: number;
  high: number;
  volMultiple: number; // x avg
  isDemo: boolean;
}

export interface MarketRegime {
  spy: { price: number; changePct: number; trend: "Up" | "Down" | "Flat" };
  qqq: { price: number; changePct: number; trend: "Up" | "Down" | "Flat" };
  vix: { level: number; trend: "Up" | "Down" | "Flat" };
  smh: { price: number; changePct: number; trend: "Up" | "Down" | "Flat" };
  bias: RegimeBias;
  scannerBias: ScannerBias;
  isDemo: boolean;
}
