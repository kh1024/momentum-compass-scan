import type {
  TradeCandidate, MarketRegime, AvoidEntry, PatternHit, BreakoutAlert,
  Direction, CapBucket, SetupType, Sentiment, Label,
} from "./types";
import { computeLevels, entryTriggerFromLevels, invalidationFromLevels } from "./supportResistanceEngine";
import { monthlyExpirationFromDte, dteFromExpiration } from "./expirationDates";

const bars = (price: number) =>
  Array.from({ length: 30 }, (_, i) => {
    const drift = (Math.sin(i / 3) + Math.cos(i / 5)) * price * 0.02;
    const c = price + drift;
    return { o: c * 0.998, h: c * 1.012, l: c * 0.988, c, v: 1_000_000 + i * 50_000, t: i };
  });

interface BuildArgs {
  ticker: string;
  direction: Direction;
  price: number;
  cap: CapBucket;
  setupType: SetupType;
  score: number;
  label: Label;
  trend: string;
  sector: string;
  sentiment?: Sentiment;
  iv: number;
  delta: number;
  ask: number;
  dte: number;
  oi: number;
  vol: number;
  spread: number;
  isLeaps?: boolean;
  isYolo?: boolean;
  whyExplode?: string;
  whyZero?: string;
  thesis?: string;
}

function build(a: BuildArgs): TradeCandidate {
  const levels = computeLevels(a.price, bars(a.price));
  const strike = a.direction === "CALL"
    ? Math.round(a.price * 1.02)
    : Math.round(a.price * 0.98);
  const theta = -(a.ask * (a.isLeaps ? 0.005 : 0.04));
  const breakeven = a.direction === "CALL" ? strike + a.ask : strike - a.ask;
  const breakevenMovePct = a.direction === "CALL"
    ? (breakeven - a.price) / a.price
    : (a.price - breakeven) / a.price;
  return {
    id: `${a.ticker}-${a.direction}-${strike}-${a.dte}`,
    ticker: a.ticker,
    direction: a.direction,
    price: a.price,
    cap: a.cap,
    setupType: a.setupType,
    score: a.score,
    label: a.label,
    trend: a.trend,
    sectorConfirmation: a.sector,
    redditSentiment: a.sentiment ?? "None",
    redditMentionTrend: a.sentiment === "Bullish" ? "Rising" : "Flat",
    levels,
    entryTrigger: entryTriggerFromLevels(a.direction, levels),
    invalidation: invalidationFromLevels(a.direction, levels),
    target1: a.direction === "CALL" ? levels.r1 : levels.s1,
    target2: a.direction === "CALL" ? levels.r2 : levels.s2,
    contract: (() => {
      const expiration = monthlyExpirationFromDte(a.dte);
      const dte = dteFromExpiration(expiration);
      return {
        expiration,
        strike, ask: a.ask, bid: a.ask * (1 - a.spread),
        cost: a.ask * 100,
        iv: a.iv, delta: a.direction === "CALL" ? a.delta : -a.delta,
        theta, thetaBurnPct: Math.abs(theta) / a.ask,
        gamma: 0.04, vega: 0.12,
        volume: a.vol, openInterest: a.oi,
        spreadPct: a.spread, dte,
        breakeven, breakevenMovePct,
        source: "mock-seed" as const,
        brokerConfirmRequired: true,
        missingFields: ["chain-not-loaded"],
      };
    })(),
    entryStrategy: a.isYolo
      ? "Tiny size only. Enter on confirmation candle with volume."
      : "Scale in 1/3 at trigger, 1/3 on hold above pivot, 1/3 on retest hold.",
    exitStrategy: a.dte <= 13
      ? "Fast trade. Stop -25% on contract. Take 50% off at +50%, runner trails."
      : "Stop -25 to -35% on contract. Trim +25-50%, more +80-100%, runner trails 20DMA.",
    profitPlan: "Trim into resistance R1 then R2. Time-stop after 5 sessions of chop.",
    sizing: a.isYolo ? "0.25-0.5% of account max" : a.isLeaps ? "1-3% of account" : "0.5-1.5% of account",
    keyRisks: a.isYolo
      ? ["IV crush", "Theta decay", "Total loss possible"]
      : ["Gap risk on news", "Failed pivot", "Sector rotation"],
    brokerConfirmRequired: true,
    isDemo: true,
    whyExplode: a.whyExplode,
    whyZero: a.whyZero,
    yoloScore: a.isYolo ? Math.round(a.score / 10) : undefined,
    thesis: a.thesis,
    monthlyReview: a.isLeaps
      ? "Monthly: confirm thesis intact, price > 200DMA, delta still > 0.5, theta burn < 1%/day."
      : undefined,
  };
}

export const MOCK_REGIME: MarketRegime = {
  spy: { price: 612.45, changePct: 0.34, trend: "Up" },
  qqq: { price: 548.22, changePct: 0.51, trend: "Up" },
  vix: { level: 14.2, trend: "Down" },
  smh: { price: 298.10, changePct: 0.78, trend: "Up" },
  bias: "Risk-on",
  scannerBias: "Calls favored",
  isDemo: true,
};

export const MOCK_CANDIDATES: TradeCandidate[] = [
  build({ ticker: "NVDA", direction: "CALL", price: 178.40, cap: "Mega", setupType: "Pullback-to-Support", score: 88, label: "Buy Now", trend: "Reclaiming 20DMA from 50DMA bounce", sector: "SMH +0.78%", sentiment: "Bullish", iv: 0.48, delta: 0.45, ask: 4.20, dte: 24, oi: 18_500, vol: 4_200, spread: 0.04 }),
  build({ ticker: "AVGO", direction: "CALL", price: 1742.10, cap: "Mega", setupType: "Pivot/Base Breakout", score: 86, label: "Buy Now", trend: "Breaking pivot on 1.6x volume", sector: "SMH +0.78%", sentiment: "Bullish", iv: 0.42, delta: 0.48, ask: 9.80, dte: 28, oi: 1_200, vol: 320, spread: 0.06 }),
  build({ ticker: "MSFT", direction: "CALL", price: 482.15, cap: "Mega", setupType: "Short-Term Momentum", score: 79, label: "Watchlist", trend: "Above all DMAs, holding pivot", sector: "Tech leaders firm", sentiment: "Mixed", iv: 0.28, delta: 0.42, ask: 5.10, dte: 21, oi: 8_200, vol: 1_100, spread: 0.05 }),
  build({ ticker: "AMD", direction: "CALL", price: 168.30, cap: "Large", setupType: "Pullback-to-Support", score: 76, label: "Watchlist", trend: "Bouncing 50DMA, RS lagging SPY", sector: "SMH +0.78%", sentiment: "Bullish", iv: 0.55, delta: 0.40, ask: 3.85, dte: 21, oi: 6_500, vol: 980, spread: 0.07 }),
  build({ ticker: "PLTR", direction: "CALL", price: 84.50, cap: "Large", setupType: "Pivot/Base Retest", score: 71, label: "Aggressive", trend: "Retesting pivot from above, volume thin", sector: "Software mixed", sentiment: "Bullish", iv: 0.62, delta: 0.38, ask: 2.90, dte: 18, oi: 9_800, vol: 1_500, spread: 0.09 }),
  build({ ticker: "SMCI", direction: "CALL", price: 47.10, cap: "Mid", setupType: "Short-Term Momentum", score: 68, label: "Aggressive", trend: "Reclaiming 20DMA, choppy base", sector: "AI infra mixed", sentiment: "Mixed", iv: 0.78, delta: 0.36, ask: 2.20, dte: 14, oi: 3_400, vol: 620, spread: 0.10 }),
  build({ ticker: "COIN", direction: "CALL", price: 312.40, cap: "Large", setupType: "Reddit YOLO", score: 58, label: "Lotto", trend: "Stretched, BTC catalyst risk", sector: "Crypto-linked", sentiment: "Hype-only", iv: 0.85, delta: 0.22, ask: 2.40, dte: 10, oi: 4_100, vol: 880, spread: 0.14, isYolo: true, whyExplode: "BTC breakout to new highs", whyZero: "BTC fade + IV crush" }),
  build({ ticker: "GME", direction: "CALL", price: 18.20, cap: "Small", setupType: "Reddit YOLO", score: 52, label: "Lotto", trend: "Reddit chatter rising, no real catalyst", sector: "Retail meme", sentiment: "Hype-only", iv: 1.05, delta: 0.18, ask: 0.72, dte: 14, oi: 22_000, vol: 5_200, spread: 0.12, isYolo: true, whyExplode: "Short squeeze rumor", whyZero: "No catalyst, IV crush guaranteed" }),
  build({ ticker: "TSLA", direction: "PUT", price: 358.20, cap: "Mega", setupType: "Failed Breakout", score: 78, label: "Watchlist", trend: "Failed pivot, losing 20DMA", sector: "EV weak", sentiment: "Bearish", iv: 0.58, delta: 0.42, ask: 6.80, dte: 21, oi: 9_500, vol: 2_100, spread: 0.05 }),
  build({ ticker: "RIVN", direction: "PUT", price: 13.40, cap: "Mid", setupType: "Breakdown", score: 64, label: "Aggressive", trend: "Lower highs, losing support", sector: "EV weak", sentiment: "Bearish", iv: 0.82, delta: 0.38, ask: 0.65, dte: 21, oi: 4_200, vol: 720, spread: 0.11 }),
  build({ ticker: "NVDA", direction: "CALL", price: 178.40, cap: "Mega", setupType: "LEAPS", score: 84, label: "Buy Now", trend: "Long-term uptrend intact", sector: "AI leader", sentiment: "Bullish", iv: 0.45, delta: 0.70, ask: 32.50, dte: 380, oi: 5_400, vol: 320, spread: 0.04, isLeaps: true, thesis: "AI capex cycle multi-year, datacenter dominance, margin expansion." }),
  build({ ticker: "MSFT", direction: "CALL", price: 482.15, cap: "Mega", setupType: "LEAPS", score: 81, label: "Buy Now", trend: "Steady uptrend", sector: "Cloud strong", sentiment: "Bullish", iv: 0.26, delta: 0.65, ask: 42.00, dte: 410, oi: 3_100, vol: 180, spread: 0.05, isLeaps: true, thesis: "Azure + Copilot monetization, durable cloud share gains." }),
  build({ ticker: "TSLA", direction: "PUT", price: 358.20, cap: "Mega", setupType: "LEAPS", score: 72, label: "Watchlist", trend: "Bearish thesis on margins", sector: "EV pricing pressure", sentiment: "Mixed", iv: 0.55, delta: 0.55, ask: 38.20, dte: 365, oi: 2_400, vol: 140, spread: 0.07, isLeaps: true, thesis: "Auto margin compression, robotaxi deferral risk, China competition." }),
];

export const MOCK_AVOID: AvoidEntry[] = [
  { ticker: "AAPL", reason: "Middle of base, no trigger", details: "Stuck between 20DMA and 50DMA, no clean entry. Wait for either reclaim or break." },
  { ticker: "META", reason: "Earnings event risk", details: "Earnings inside DTE window. IV elevated, expected move > breakeven cushion." },
  { ticker: "ARKK", reason: "Below 200DMA + wide spreads", details: "Trend broken, option spreads >18% on listed strikes." },
  { ticker: "BB", reason: "Reddit hype only, no catalyst", details: "Mention spike with no fundamental driver. Pure squeeze speculation." },
  { ticker: "BABA", reason: "Failed pivot breakout", details: "Pivot break reversed same session, now back inside base." },
];

export const MOCK_PATTERNS: PatternHit[] = [
  { ticker: "NVDA", pattern: "Bull Flag", bias: "Bullish", confidence: 82, trigger: 180.0, target: 192.0, isDemo: true },
  { ticker: "AVGO", pattern: "Cup & Handle", bias: "Bullish", confidence: 78, trigger: 1755, target: 1860, isDemo: true },
  { ticker: "AMD", pattern: "Higher Low", bias: "Bullish", confidence: 71, trigger: 170.0, target: 182.0, isDemo: true },
  { ticker: "TSLA", pattern: "Head & Shoulders", bias: "Bearish", confidence: 74, trigger: 348.0, target: 322.0, isDemo: true },
  { ticker: "RIVN", pattern: "Descending Triangle", bias: "Bearish", confidence: 69, trigger: 13.0, target: 11.5, isDemo: true },
];

export const MOCK_BREAKOUTS: BreakoutAlert[] = [
  { ticker: "AVGO", window: 5, price: 1755, high: 1748, volMultiple: 1.7, isDemo: true },
  { ticker: "NVDA", window: 5, price: 180.2, high: 179.5, volMultiple: 1.5, isDemo: true },
  { ticker: "MSFT", window: 10, price: 484.1, high: 482.0, volMultiple: 1.6, isDemo: true },
  { ticker: "AVGO", window: 10, price: 1755, high: 1740, volMultiple: 1.7, isDemo: true },
  { ticker: "PLTR", window: 5, price: 85.0, high: 84.7, volMultiple: 2.1, isDemo: true },
];
