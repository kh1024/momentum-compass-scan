import type {
  TradeCandidate, MarketRegime, AvoidEntry, PatternHit, BreakoutAlert,
  Direction, CapBucket, SetupType, Sentiment, Label,
} from "./types";
import { computeLevels, entryTriggerFromLevels, invalidationFromLevels } from "./supportResistanceEngine";
import { weeklyExpirationFromDte, dteFromExpiration } from "./expirationDates";

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
      const expiration = weeklyExpirationFromDte(a.dte);
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

// ---------------------------------------------------------------------------
// Universe-based candidate generation
// ---------------------------------------------------------------------------

interface UniverseSeed {
  price: number;
  direction: Direction;
  cap: CapBucket;
  setupType: SetupType;
  score: number;
  label: Label;
  trend: string;
  sector: string;
  iv: number;
  delta: number;
  ask: number;
  dte: number;
  oi: number;
  vol: number;
  spread: number;
  sentiment?: Sentiment;
  isYolo?: boolean;
  whyExplode?: string;
  whyZero?: string;
}

const UNIVERSE_SEEDS: Record<string, UniverseSeed> = {
  // ---- Mega/Large -----------------------------------------------------------
  AAPL:  { price: 205.40, direction: "CALL", cap: "Mega",  setupType: "Pullback-to-Support",  score: 78, label: "Watchlist",  trend: "Bouncing off 50DMA support",              sector: "Tech",          iv: 0.25, delta: 0.42, ask: 3.80,  dte: 21, oi: 12000, vol: 3200, spread: 0.04 },
  GOOGL: { price: 195.20, direction: "CALL", cap: "Mega",  setupType: "Pivot/Base Breakout",  score: 82, label: "Watchlist",  trend: "Breaking above pivot on volume",          sector: "Tech",          iv: 0.30, delta: 0.44, ask: 4.20,  dte: 24, oi:  5800, vol: 1200, spread: 0.05 },
  META:  { price: 620.10, direction: "CALL", cap: "Mega",  setupType: "Short-Term Momentum",  score: 80, label: "Watchlist",  trend: "Above all DMAs, momentum intact",         sector: "Tech",          iv: 0.32, delta: 0.45, ask: 11.50, dte: 21, oi:  4200, vol:  980, spread: 0.05 },
  AMZN:  { price: 225.80, direction: "CALL", cap: "Mega",  setupType: "Pullback-to-Support",  score: 79, label: "Watchlist",  trend: "Reclaiming 20DMA",                        sector: "Consumer",      iv: 0.28, delta: 0.43, ask: 4.60,  dte: 21, oi:  6500, vol: 1800, spread: 0.04 },
  NFLX:  { price: 1180.50, direction: "CALL", cap: "Large", setupType: "Pivot/Base Retest",   score: 75, label: "Watchlist",  trend: "Retesting breakout level",                sector: "Streaming",     iv: 0.35, delta: 0.41, ask: 18.20, dte: 18, oi:  1800, vol:  420, spread: 0.06 },
  COST:  { price: 912.40, direction: "CALL", cap: "Mega",  setupType: "Pullback-to-Support",  score: 76, label: "Watchlist",  trend: "Retailing powerhouse 50DMA support",      sector: "Retail",        iv: 0.20, delta: 0.42, ask: 12.40, dte: 21, oi:  1800, vol:  420, spread: 0.05 },
  CRM:   { price: 312.40, direction: "CALL", cap: "Large", setupType: "Pullback-to-Support",  score: 72, label: "Watchlist",  trend: "50DMA support bounce",                    sector: "Software",      iv: 0.30, delta: 0.40, ask: 5.40,  dte: 21, oi:  2100, vol:  580, spread: 0.06 },
  ORCL:  { price: 185.20, direction: "CALL", cap: "Large", setupType: "Pivot/Base Breakout",  score: 74, label: "Watchlist",  trend: "Breaking multi-week resistance",           sector: "Software",      iv: 0.28, delta: 0.42, ask: 4.10,  dte: 21, oi:  1900, vol:  460, spread: 0.06 },
  QCOM:  { price: 178.90, direction: "CALL", cap: "Large", setupType: "Short-Term Momentum",  score: 71, label: "Watchlist",  trend: "Momentum from chip cycle",                sector: "Semis",         iv: 0.34, delta: 0.40, ask: 4.20,  dte: 18, oi:  2800, vol:  620, spread: 0.07 },
  MU:    { price: 112.40, direction: "CALL", cap: "Large", setupType: "Pivot/Base Breakout",  score: 77, label: "Watchlist",  trend: "Memory cycle turning, breaking pivot",    sector: "Semis",         iv: 0.45, delta: 0.44, ask: 3.60,  dte: 21, oi:  4200, vol:  980, spread: 0.06 },
  ARM:   { price: 148.20, direction: "CALL", cap: "Large", setupType: "Short-Term Momentum",  score: 75, label: "Watchlist",  trend: "AI chip architecture momentum",           sector: "Semis",         iv: 0.50, delta: 0.42, ask: 5.20,  dte: 21, oi:  2800, vol:  680, spread: 0.07 },
  ASML:  { price: 820.40, direction: "CALL", cap: "Mega",  setupType: "Pullback-to-Support",  score: 73, label: "Watchlist",  trend: "EUV monopoly, retesting breakout",        sector: "Semis equip",   iv: 0.30, delta: 0.42, ask: 16.80, dte: 24, oi:   980, vol:  220, spread: 0.06 },
  TSM:   { price:  98.20, direction: "CALL", cap: "Mega",  setupType: "Pivot/Base Retest",    score: 74, label: "Watchlist",  trend: "Foundry leader, AI demand intact",        sector: "Semis",         iv: 0.32, delta: 0.44, ask: 2.20,  dte: 21, oi:  5800, vol: 1200, spread: 0.05 },
  // ---- ETFs -----------------------------------------------------------------
  SPY:   { price: 612.45, direction: "CALL", cap: "Large", setupType: "Short-Term Momentum",  score: 76, label: "Watchlist",  trend: "Trend intact, above 20DMA",               sector: "Broad market",  iv: 0.14, delta: 0.50, ask: 5.80,  dte: 14, oi: 45000, vol: 12000, spread: 0.02 },
  QQQ:   { price: 548.22, direction: "CALL", cap: "Large", setupType: "Short-Term Momentum",  score: 75, label: "Watchlist",  trend: "Tech leadership holding",                 sector: "Tech ETF",      iv: 0.16, delta: 0.48, ask: 5.20,  dte: 14, oi: 38000, vol:  9800, spread: 0.02 },
  IWM:   { price: 198.40, direction: "CALL", cap: "Small", setupType: "Pullback-to-Support",  score: 66, label: "Aggressive", trend: "Testing 50DMA support",                   sector: "Small cap",     iv: 0.20, delta: 0.42, ask: 2.80,  dte: 14, oi:  8200, vol:  2100, spread: 0.04 },
  SMH:   { price: 248.20, direction: "CALL", cap: "Large", setupType: "Short-Term Momentum",  score: 74, label: "Watchlist",  trend: "Semis sector leadership, AI tailwind",    sector: "Semis ETF",     iv: 0.28, delta: 0.46, ask: 4.80,  dte: 14, oi:  6200, vol:  1600, spread: 0.04 },
  SOXX:  { price: 218.40, direction: "CALL", cap: "Large", setupType: "Pullback-to-Support",  score: 70, label: "Watchlist",  trend: "Semis 50DMA support hold",                sector: "Semis ETF",     iv: 0.26, delta: 0.44, ask: 4.20,  dte: 14, oi:  4200, vol:  1100, spread: 0.04 },
  XLE:   { price:  92.30, direction: "CALL", cap: "Large", setupType: "Pullback-to-Support",  score: 64, label: "Aggressive", trend: "Energy 50DMA bounce attempt",             sector: "Energy",        iv: 0.22, delta: 0.40, ask: 1.60,  dte: 14, oi:  4100, vol:   840, spread: 0.05 },
  XLF:   { price:  48.20, direction: "CALL", cap: "Large", setupType: "Short-Term Momentum",  score: 70, label: "Watchlist",  trend: "Financial sector strength",               sector: "Financials",    iv: 0.18, delta: 0.44, ask: 0.90,  dte: 14, oi:  8800, vol:  2200, spread: 0.04 },
  XLK:   { price: 242.10, direction: "CALL", cap: "Large", setupType: "Short-Term Momentum",  score: 73, label: "Watchlist",  trend: "Sector leader outperforming",             sector: "Tech sector",   iv: 0.18, delta: 0.46, ask: 3.20,  dte: 14, oi:  3200, vol:   780, spread: 0.04 },
  XBI:   { price:  88.40, direction: "CALL", cap: "Mid",   setupType: "Pivot/Base Retest",    score: 62, label: "Aggressive", trend: "Biotech retest of breakout level",        sector: "Biotech",       iv: 0.28, delta: 0.38, ask: 2.10,  dte: 21, oi:  2200, vol:   520, spread: 0.08 },
  ARKK:  { price:  62.40, direction: "CALL", cap: "Mid",   setupType: "Pivot/Base Retest",    score: 60, label: "Aggressive", trend: "Innovation ETF retest of resistance",     sector: "Disruptive",    iv: 0.40, delta: 0.38, ask: 1.40,  dte: 21, oi:  3800, vol:   820, spread: 0.08 },
  // ---- Mid Momentum ---------------------------------------------------------
  CRWD:  { price: 380.20, direction: "CALL", cap: "Large", setupType: "Pivot/Base Breakout",  score: 81, label: "Watchlist",  trend: "Security sector leader breakout",         sector: "Cybersecurity", iv: 0.40, delta: 0.44, ask: 8.40,  dte: 21, oi:  2800, vol:   720, spread: 0.06 },
  SNOW:  { price: 158.40, direction: "CALL", cap: "Mid",   setupType: "Pivot/Base Retest",    score: 68, label: "Aggressive", trend: "Retest of breakout, volume fading",       sector: "Cloud",         iv: 0.52, delta: 0.38, ask: 4.80,  dte: 18, oi:  1800, vol:   380, spread: 0.09 },
  DDOG:  { price: 118.20, direction: "CALL", cap: "Mid",   setupType: "Short-Term Momentum",  score: 70, label: "Aggressive", trend: "Momentum above 20DMA",                    sector: "Cloud",         iv: 0.48, delta: 0.40, ask: 3.40,  dte: 18, oi:  1600, vol:   420, spread: 0.08 },
  NET:   { price: 145.80, direction: "CALL", cap: "Mid",   setupType: "Pullback-to-Support",  score: 69, label: "Watchlist",  trend: "50DMA support bounce",                    sector: "Cloud",         iv: 0.46, delta: 0.40, ask: 4.20,  dte: 21, oi:  1900, vol:   460, spread: 0.08 },
  HOOD:  { price:  48.20, direction: "CALL", cap: "Mid",   setupType: "Pivot/Base Breakout",  score: 66, label: "Aggressive", trend: "Breaking pivot on retail volume",         sector: "Fintech",       iv: 0.65, delta: 0.38, ask: 1.80,  dte: 14, oi:  4800, vol:  1200, spread: 0.11 },
  SOFI:  { price:  15.40, direction: "CALL", cap: "Mid",   setupType: "Pivot/Base Retest",    score: 60, label: "Aggressive", trend: "Retest of recent pivot",                  sector: "Fintech",       iv: 0.60, delta: 0.36, ask: 0.48,  dte: 14, oi:  5800, vol:  1400, spread: 0.12 },
  RBLX:  { price:  58.20, direction: "CALL", cap: "Mid",   setupType: "Short-Term Momentum",  score: 58, label: "Aggressive", trend: "Gaming sector momentum",                  sector: "Gaming",        iv: 0.55, delta: 0.35, ask: 1.40,  dte: 14, oi:  3200, vol:   680, spread: 0.11 },
  UBER:  { price:  82.40, direction: "CALL", cap: "Large", setupType: "Pullback-to-Support",  score: 74, label: "Watchlist",  trend: "20DMA support reclaim attempt",           sector: "Transportation",iv: 0.36, delta: 0.42, ask: 2.20,  dte: 21, oi:  2800, vol:   680, spread: 0.06 },
  SHOP:  { price: 112.40, direction: "CALL", cap: "Large", setupType: "Pivot/Base Breakout",  score: 75, label: "Watchlist",  trend: "E-commerce leader breakout above pivot",  sector: "E-commerce",    iv: 0.44, delta: 0.44, ask: 3.20,  dte: 21, oi:  3200, vol:   780, spread: 0.07 },
  AFRM:  { price:  48.20, direction: "CALL", cap: "Mid",   setupType: "Short-Term Momentum",  score: 65, label: "Aggressive", trend: "BNPL momentum, rates easing tailwind",    sector: "Fintech",       iv: 0.72, delta: 0.38, ask: 1.80,  dte: 18, oi:  3800, vol:   920, spread: 0.12 },
  UPST:  { price:  68.40, direction: "CALL", cap: "Mid",   setupType: "Pivot/Base Retest",    score: 62, label: "Aggressive", trend: "AI lending retest of resistance",          sector: "Fintech AI",    iv: 0.80, delta: 0.36, ask: 2.20,  dte: 18, oi:  2800, vol:   620, spread: 0.13 },
  IONQ:  { price:  22.40, direction: "CALL", cap: "Small", setupType: "Short-Term Momentum",  score: 58, label: "Aggressive", trend: "Quantum computing speculation rally",      sector: "Quantum",       iv: 0.90, delta: 0.32, ask: 0.88,  dte: 14, oi:  4800, vol:  1100, spread: 0.14 },
  RKLB:  { price:  24.80, direction: "CALL", cap: "Small", setupType: "Pivot/Base Breakout",  score: 60, label: "Aggressive", trend: "Space launch momentum breaking pivot",     sector: "Space",         iv: 0.85, delta: 0.35, ask: 1.20,  dte: 14, oi:  3600, vol:   820, spread: 0.14 },
  SMCI:  { price:  42.80, direction: "CALL", cap: "Mid",   setupType: "Pullback-to-Support",  score: 64, label: "Aggressive", trend: "AI server demand, 50DMA bounce",           sector: "AI servers",    iv: 0.75, delta: 0.38, ask: 1.60,  dte: 14, oi:  5200, vol:  1200, spread: 0.13 },
  // ---- YOLO/Reddit ---------------------------------------------------------
  GME:  { price:  18.20, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 52, label: "Lotto", trend: "Reddit chatter rising",          sector: "Retail meme",   iv: 1.05, delta: 0.18, ask: 0.72, dte: 14, oi: 22000, vol: 5200, spread: 0.12, isYolo: true, whyExplode: "Short squeeze rumor",                       whyZero: "No catalyst, IV crush guaranteed" },
  RIVN: { price:  12.40, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 54, label: "Lotto", trend: "EV speculation, production news",  sector: "EV",            iv: 0.95, delta: 0.22, ask: 0.48, dte: 10, oi:  8200, vol: 1800, spread: 0.16, isYolo: true, whyExplode: "Amazon delivery deal expansion",            whyZero: "Cash burn + dilution risk" },
  LCID: { price:   2.80, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 42, label: "Lotto", trend: "Low-priced EV lottery",           sector: "EV",            iv: 1.10, delta: 0.18, ask: 0.08, dte: 10, oi:  6200, vol: 1600, spread: 0.22, isYolo: true, whyExplode: "Saudi investment catalyst",                 whyZero: "Near-zero production, solvency risk" },
  MARA: { price:  22.40, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 55, label: "Lotto", trend: "BTC miner momentum",              sector: "Crypto mining", iv: 0.95, delta: 0.22, ask: 0.68, dte: 10, oi:  6200, vol: 1600, spread: 0.16, isYolo: true, whyExplode: "BTC breakout to new highs",                 whyZero: "BTC fade + margin pressure" },
  RIOT: { price:  12.40, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 52, label: "Lotto", trend: "BTC miner speculation",           sector: "Crypto mining", iv: 0.98, delta: 0.20, ask: 0.38, dte: 10, oi:  5800, vol: 1200, spread: 0.17, isYolo: true, whyExplode: "Hash-rate expansion + BTC price",           whyZero: "BTC sells off, IV crush" },
  IREN: { price:  10.20, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 50, label: "Lotto", trend: "Crypto miner AI data center pivot", sector: "Crypto mining", iv: 1.05, delta: 0.20, ask: 0.32, dte: 10, oi:  3200, vol:  720, spread: 0.18, isYolo: true, whyExplode: "BTC + AI data center narrative",            whyZero: "No BTC move, time decay wins" },
  WULF: { price:   4.80, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 46, label: "Lotto", trend: "Small miner BTC correlation",      sector: "Crypto mining", iv: 1.15, delta: 0.16, ask: 0.12, dte: 10, oi:  2800, vol:  620, spread: 0.22, isYolo: true, whyExplode: "BTC spike + low float squeeze",             whyZero: "Dilution + no BTC catalyst" },
  ACHR: { price:   8.40, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 50, label: "Lotto", trend: "Air taxi FAA approval speculation", sector: "Air taxi",      iv: 1.00, delta: 0.20, ask: 0.28, dte: 10, oi:  4200, vol:  920, spread: 0.20, isYolo: true, whyExplode: "FAA certification milestone news",          whyZero: "Regulatory delay + IV crush" },
  JOBY: { price:   6.20, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 48, label: "Lotto", trend: "eVTOL hype speculation",           sector: "Air taxi",      iv: 1.05, delta: 0.18, ask: 0.20, dte: 10, oi:  3600, vol:  820, spread: 0.21, isYolo: true, whyExplode: "Toyota partnership + FAA progress",        whyZero: "Pre-revenue + time decay" },
  OPEN: { price:   2.20, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 44, label: "Lotto", trend: "PropTech turnaround speculation",   sector: "PropTech",      iv: 1.20, delta: 0.15, ask: 0.06, dte: 10, oi:  5200, vol: 1100, spread: 0.25, isYolo: true, whyExplode: "Housing market recovery + short squeeze",  whyZero: "Balance sheet risk, rate sensitivity" },
  HIMS: { price:  28.40, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 55, label: "Lotto", trend: "Health-tech Reddit buzz",           sector: "Health tech",   iv: 0.78, delta: 0.25, ask: 0.88, dte: 10, oi:  4200, vol:  980, spread: 0.15, isYolo: true, whyExplode: "GLP-1 / weight-loss product expansion",    whyZero: "Competition + IV crush on pop" },
  ASTS: { price:  22.40, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 54, label: "Lotto", trend: "Space mobile network hype",         sector: "Space",         iv: 1.10, delta: 0.22, ask: 0.88, dte: 10, oi:  6200, vol: 1400, spread: 0.18, isYolo: true, whyExplode: "Satellite constellation launch milestone",  whyZero: "Execution risk + IV crush" },
  OKLO: { price:  32.40, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 52, label: "Lotto", trend: "Nuclear energy AI power hype",      sector: "Nuclear",       iv: 0.95, delta: 0.22, ask: 1.20, dte: 10, oi:  3800, vol:  820, spread: 0.17, isYolo: true, whyExplode: "AI data center power demand narrative",    whyZero: "Far from revenue + IV crush" },
  QS:   { price:   4.80, direction: "CALL", cap: "Small", setupType: "Reddit YOLO", score: 46, label: "Lotto", trend: "Solid-state battery speculation",    sector: "Battery tech",  iv: 1.15, delta: 0.16, ask: 0.14, dte: 10, oi:  4200, vol:  920, spread: 0.22, isYolo: true, whyExplode: "Partnership or production milestone",      whyZero: "Pre-revenue, technical challenges" },
};

/**
 * Build a candidate list from the active universe.
 * Tickers already present in MOCK_CANDIDATES keep their seed entries
 * (including LEAPS duplicates). New tickers use UNIVERSE_SEEDS.
 */
export function buildUniverseCandidates(tickers: string[]): TradeCandidate[] {
  const out: TradeCandidate[] = [];
  const covered = new Set<string>();

  for (const ticker of tickers) {
    const existing = MOCK_CANDIDATES.filter((c) => c.ticker === ticker);
    if (existing.length > 0) {
      out.push(...existing);
      covered.add(ticker);
      continue;
    }
    const seed = UNIVERSE_SEEDS[ticker];
    if (!seed) continue;
    out.push(
      build({
        ticker,
        direction:  seed.direction,
        price:      seed.price,
        cap:        seed.cap,
        setupType:  seed.setupType,
        score:      seed.score,
        label:      seed.label,
        trend:      seed.trend,
        sector:     seed.sector,
        sentiment:  seed.sentiment,
        iv:         seed.iv,
        delta:      seed.delta,
        ask:        seed.ask,
        dte:        seed.dte,
        oi:         seed.oi,
        vol:        seed.vol,
        spread:     seed.spread,
        isYolo:     seed.isYolo,
        whyExplode: seed.whyExplode,
        whyZero:    seed.whyZero,
      }),
    );
    covered.add(ticker);
  }
  return out;
}

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
