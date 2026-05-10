/**
 * Performance Page — demo dataset + analytics helpers.
 *
 * All numbers are illustrative. The header on the Performance page warns the
 * user explicitly: past scanner performance does not guarantee future results.
 */

export type Direction = "CALL" | "PUT" | "LEAPS_CALL" | "LEAPS_PUT" | "YOLO";
export type SetupType =
  | "Pullback-to-Support"
  | "Pivot/Base Breakout"
  | "Pivot/Base Retest"
  | "Big Win Momentum"
  | "Clean Swing"
  | "Reddit YOLO"
  | "LEAPS"
  | "Avoid";
export type Label = "Buy Now" | "Watchlist" | "Aggressive" | "Lotto Only" | "Avoid";
export type MarketRegime = "Risk-on" | "Mixed" | "Risk-off";
export type Grade = "A+" | "A" | "B" | "C" | "D" | "F";

export interface Pick {
  id: string;
  scanDate: string;          // ISO yyyy-mm-dd
  scanTime: string;          // HH:MM
  ticker: string;
  direction: Direction;
  setupType: SetupType;
  label: Label;
  aiScore: number;
  confidenceScore: number;
  priceAtScan: number;
  entryTrigger: number;
  invalidation: number;
  target1: number;
  target2: number;
  optionExpiration: string;
  optionStrike: number;
  optionType: "C" | "P";
  askAtScan: number;
  bidAtScan: number;
  spreadPct: number;
  delta: number;
  theta: number;
  thetaBurnPct: number;
  iv: number;
  volume: number;
  openInterest: number;
  dte: number;
  breakeven: number;
  breakevenMovePct: number;
  redditSentiment: "Bullish" | "Mixed" | "Bearish" | "Hype-only";
  marketRegime: MarketRegime;
  sector: string;
  isDemo: true;
}

export interface TrackedPick {
  pickId: string;
  triggerFired: boolean;
  triggerTime: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  maxGainPct: number;       // option max favorable excursion
  maxDrawdownPct: number;   // option max adverse excursion
  finalReturnPct: number;
  stockMoveAfterTriggerPct: number;
  timeToPlus25Min: number | null;
  timeToPlus50Min: number | null;
  timeToPlus100Min: number | null;
  hitTarget1: boolean;
  hitTarget2: boolean;
  hitStop: boolean;
  invalidated: boolean;
  setupGrade: Grade;
  contractGrade: Grade;
  entryGrade: Grade;
  exitGrade: Grade;
  finalGrade: Grade;
  notes: string;
  mistakeCategory: string | null;
  improvement: string | null;
  holdTimeMin: number;
}

// ----- Demo picks --------------------------------------------------

export const DEMO_PICKS: Pick[] = [
  {
    id: "p-nvda-pb",
    scanDate: "2026-04-21", scanTime: "10:14", ticker: "NVDA",
    direction: "CALL", setupType: "Pullback-to-Support", label: "Buy Now",
    aiScore: 88, confidenceScore: 82, priceAtScan: 921.4,
    entryTrigger: 924, invalidation: 908, target1: 945, target2: 970,
    optionExpiration: "2026-05-16", optionStrike: 930, optionType: "C",
    askAtScan: 18.4, bidAtScan: 18.1, spreadPct: 0.016,
    delta: 0.46, theta: -0.42, thetaBurnPct: 0.023,
    iv: 0.41, volume: 8240, openInterest: 14200, dte: 25,
    breakeven: 948.4, breakevenMovePct: 0.029,
    redditSentiment: "Bullish", marketRegime: "Risk-on", sector: "Semis",
    isDemo: true,
  },
  {
    id: "p-amd-bw",
    scanDate: "2026-04-22", scanTime: "09:52", ticker: "AMD",
    direction: "CALL", setupType: "Big Win Momentum", label: "Aggressive",
    aiScore: 81, confidenceScore: 74, priceAtScan: 168.2,
    entryTrigger: 169.5, invalidation: 163, target1: 176, target2: 184,
    optionExpiration: "2026-05-09", optionStrike: 170, optionType: "C",
    askAtScan: 4.6, bidAtScan: 4.45, spreadPct: 0.033,
    delta: 0.49, theta: -0.18, thetaBurnPct: 0.039,
    iv: 0.55, volume: 12100, openInterest: 22000, dte: 18,
    breakeven: 174.6, breakevenMovePct: 0.038,
    redditSentiment: "Mixed", marketRegime: "Risk-on", sector: "Semis",
    isDemo: true,
  },
  {
    id: "p-avgo-pivot",
    scanDate: "2026-04-23", scanTime: "11:08", ticker: "AVGO",
    direction: "CALL", setupType: "Pivot/Base Breakout", label: "Buy Now",
    aiScore: 85, confidenceScore: 79, priceAtScan: 1342,
    entryTrigger: 1351, invalidation: 1320, target1: 1395, target2: 1430,
    optionExpiration: "2026-05-23", optionStrike: 1360, optionType: "C",
    askAtScan: 32.1, bidAtScan: 31.4, spreadPct: 0.022,
    delta: 0.42, theta: -0.71, thetaBurnPct: 0.022,
    iv: 0.36, volume: 1180, openInterest: 2400, dte: 32,
    breakeven: 1392.1, breakevenMovePct: 0.037,
    redditSentiment: "Bullish", marketRegime: "Risk-on", sector: "Semis",
    isDemo: true,
  },
  {
    id: "p-msft-reclaim",
    scanDate: "2026-04-24", scanTime: "10:31", ticker: "MSFT",
    direction: "CALL", setupType: "Pullback-to-Support", label: "Watchlist",
    aiScore: 76, confidenceScore: 70, priceAtScan: 412.5,
    entryTrigger: 414, invalidation: 405, target1: 422, target2: 432,
    optionExpiration: "2026-05-16", optionStrike: 415, optionType: "C",
    askAtScan: 6.2, bidAtScan: 6.05, spreadPct: 0.024,
    delta: 0.44, theta: -0.21, thetaBurnPct: 0.034,
    iv: 0.27, volume: 4500, openInterest: 9100, dte: 22,
    breakeven: 421.2, breakevenMovePct: 0.021,
    redditSentiment: "Mixed", marketRegime: "Mixed", sector: "Mega-Tech",
    isDemo: true,
  },
  {
    id: "p-pltr-put",
    scanDate: "2026-04-25", scanTime: "13:02", ticker: "PLTR",
    direction: "PUT", setupType: "Clean Swing", label: "Aggressive",
    aiScore: 72, confidenceScore: 65, priceAtScan: 24.8,
    entryTrigger: 24.4, invalidation: 25.8, target1: 23.0, target2: 22.0,
    optionExpiration: "2026-05-16", optionStrike: 24, optionType: "P",
    askAtScan: 0.85, bidAtScan: 0.78, spreadPct: 0.085,
    delta: -0.41, theta: -0.04, thetaBurnPct: 0.047,
    iv: 0.62, volume: 3300, openInterest: 7800, dte: 22,
    breakeven: 23.15, breakevenMovePct: 0.067,
    redditSentiment: "Bearish", marketRegime: "Mixed", sector: "Software",
    isDemo: true,
  },
  {
    id: "p-smci-yolo",
    scanDate: "2026-04-26", scanTime: "14:45", ticker: "SMCI",
    direction: "YOLO", setupType: "Reddit YOLO", label: "Lotto Only",
    aiScore: 58, confidenceScore: 41, priceAtScan: 812,
    entryTrigger: 820, invalidation: 790, target1: 860, target2: 900,
    optionExpiration: "2026-05-02", optionStrike: 860, optionType: "C",
    askAtScan: 5.1, bidAtScan: 4.4, spreadPct: 0.149,
    delta: 0.18, theta: -0.55, thetaBurnPct: 0.108,
    iv: 0.94, volume: 6800, openInterest: 4100, dte: 6,
    breakeven: 865.1, breakevenMovePct: 0.065,
    redditSentiment: "Hype-only", marketRegime: "Risk-on", sector: "Semis",
    isDemo: true,
  },
  {
    id: "p-tsla-leap-put",
    scanDate: "2026-03-12", scanTime: "10:00", ticker: "TSLA",
    direction: "LEAPS_PUT", setupType: "LEAPS", label: "Watchlist",
    aiScore: 70, confidenceScore: 63, priceAtScan: 178,
    entryTrigger: 175, invalidation: 192, target1: 160, target2: 145,
    optionExpiration: "2027-01-15", optionStrike: 170, optionType: "P",
    askAtScan: 22.5, bidAtScan: 21.9, spreadPct: 0.027,
    delta: -0.42, theta: -0.04, thetaBurnPct: 0.002,
    iv: 0.58, volume: 410, openInterest: 8300, dte: 309,
    breakeven: 147.5, breakevenMovePct: 0.171,
    redditSentiment: "Mixed", marketRegime: "Mixed", sector: "Auto",
    isDemo: true,
  },
  {
    id: "p-nvda-leap",
    scanDate: "2026-02-04", scanTime: "10:00", ticker: "NVDA",
    direction: "LEAPS_CALL", setupType: "LEAPS", label: "Buy Now",
    aiScore: 92, confidenceScore: 88, priceAtScan: 705,
    entryTrigger: 712, invalidation: 660, target1: 820, target2: 920,
    optionExpiration: "2027-01-15", optionStrike: 700, optionType: "C",
    askAtScan: 132, bidAtScan: 130, spreadPct: 0.015,
    delta: 0.62, theta: -0.18, thetaBurnPct: 0.0014,
    iv: 0.39, volume: 580, openInterest: 14800, dte: 346,
    breakeven: 832, breakevenMovePct: 0.18,
    redditSentiment: "Bullish", marketRegime: "Risk-on", sector: "Semis",
    isDemo: true,
  },
];

export const DEMO_TRACKED: TrackedPick[] = [
  {
    pickId: "p-nvda-pb", triggerFired: true, triggerTime: "10:42",
    entryPrice: 18.55, exitPrice: 28.4,
    maxGainPct: 0.71, maxDrawdownPct: -0.12, finalReturnPct: 0.531,
    stockMoveAfterTriggerPct: 0.029, timeToPlus25Min: 38, timeToPlus50Min: 145, timeToPlus100Min: null,
    hitTarget1: true, hitTarget2: false, hitStop: false, invalidated: false,
    setupGrade: "A", contractGrade: "A", entryGrade: "A+", exitGrade: "A", finalGrade: "A",
    notes: "Clean 50DMA bounce, respected level, sold half at +50% kept runner.",
    mistakeCategory: null, improvement: "Could have trailed runner higher.",
    holdTimeMin: 285,
  },
  {
    pickId: "p-amd-bw", triggerFired: true, triggerTime: "09:58",
    entryPrice: 4.65, exitPrice: 6.95,
    maxGainPct: 0.62, maxDrawdownPct: -0.18, finalReturnPct: 0.495,
    stockMoveAfterTriggerPct: 0.041, timeToPlus25Min: 22, timeToPlus50Min: 110, timeToPlus100Min: null,
    hitTarget1: true, hitTarget2: false, hitStop: false, invalidated: false,
    setupGrade: "A", contractGrade: "B", entryGrade: "A", exitGrade: "B", finalGrade: "A",
    notes: "Strong momentum continuation, IV expansion helped.",
    mistakeCategory: null, improvement: "Spread of 3.3% added slippage; choose tighter chains.",
    holdTimeMin: 210,
  },
  {
    pickId: "p-avgo-pivot", triggerFired: true, triggerTime: "11:34",
    entryPrice: 32.5, exitPrice: 41.2,
    maxGainPct: 0.42, maxDrawdownPct: -0.09, finalReturnPct: 0.268,
    stockMoveAfterTriggerPct: 0.026, timeToPlus25Min: 90, timeToPlus50Min: null, timeToPlus100Min: null,
    hitTarget1: true, hitTarget2: false, hitStop: false, invalidated: false,
    setupGrade: "A+", contractGrade: "A", entryGrade: "A", exitGrade: "B", finalGrade: "A",
    notes: "Textbook pivot break, good follow-through.",
    mistakeCategory: null, improvement: null,
    holdTimeMin: 1320,
  },
  {
    pickId: "p-msft-reclaim", triggerFired: false, triggerTime: null,
    entryPrice: null, exitPrice: null,
    maxGainPct: 0.09, maxDrawdownPct: -0.21, finalReturnPct: -0.18,
    stockMoveAfterTriggerPct: -0.011, timeToPlus25Min: null, timeToPlus50Min: null, timeToPlus100Min: null,
    hitTarget1: false, hitTarget2: false, hitStop: false, invalidated: true,
    setupGrade: "B", contractGrade: "B", entryGrade: "C", exitGrade: "C", finalGrade: "C",
    notes: "Trigger never fired; setup chopped sideways and theta ate it.",
    mistakeCategory: "Entered before trigger", improvement: "Wait for confirmation candle.",
    holdTimeMin: 480,
  },
  {
    pickId: "p-pltr-put", triggerFired: true, triggerTime: "13:38",
    entryPrice: 0.82, exitPrice: 0.34,
    maxGainPct: 0.21, maxDrawdownPct: -0.62, finalReturnPct: -0.585,
    stockMoveAfterTriggerPct: 0.012, timeToPlus25Min: null, timeToPlus50Min: null, timeToPlus100Min: null,
    hitTarget1: false, hitTarget2: false, hitStop: true, invalidated: true,
    setupGrade: "C", contractGrade: "D", entryGrade: "C", exitGrade: "D", finalGrade: "D",
    notes: "Risk-on tape, fighting trend with a put — wide spread crushed exit.",
    mistakeCategory: "Counter-trend put in risk-on regime", improvement: "Skip puts when SPY/QQQ green.",
    holdTimeMin: 240,
  },
  {
    pickId: "p-smci-yolo", triggerFired: true, triggerTime: "14:58",
    entryPrice: 5.0, exitPrice: 0.6,
    maxGainPct: 0.18, maxDrawdownPct: -0.92, finalReturnPct: -0.88,
    stockMoveAfterTriggerPct: -0.018, timeToPlus25Min: null, timeToPlus50Min: null, timeToPlus100Min: null,
    hitTarget1: false, hitTarget2: false, hitStop: true, invalidated: true,
    setupGrade: "D", contractGrade: "F", entryGrade: "D", exitGrade: "C", finalGrade: "F",
    notes: "Hype-only YOLO with 6 DTE and 0.18 delta — theta + IV crush killed it.",
    mistakeCategory: "Hype-only YOLO too far OTM", improvement: "Require real catalyst + delta ≥ 0.25 for YOLO.",
    holdTimeMin: 90,
  },
  {
    pickId: "p-tsla-leap-put", triggerFired: true, triggerTime: "next-day",
    entryPrice: 22.7, exitPrice: 31.9,
    maxGainPct: 0.55, maxDrawdownPct: -0.14, finalReturnPct: 0.405,
    stockMoveAfterTriggerPct: -0.066, timeToPlus25Min: 14400, timeToPlus50Min: 28800, timeToPlus100Min: null,
    hitTarget1: true, hitTarget2: false, hitStop: false, invalidated: false,
    setupGrade: "A", contractGrade: "A", entryGrade: "A", exitGrade: "B", finalGrade: "A",
    notes: "LEAPS gave room; thesis (margin compression) intact.",
    mistakeCategory: null, improvement: "Could have rolled strikes lower into target.",
    holdTimeMin: 60480,
  },
  {
    pickId: "p-nvda-leap", triggerFired: true, triggerTime: "next-day",
    entryPrice: 134, exitPrice: 218,
    maxGainPct: 0.78, maxDrawdownPct: -0.18, finalReturnPct: 0.627,
    stockMoveAfterTriggerPct: 0.27, timeToPlus25Min: 7200, timeToPlus50Min: 14400, timeToPlus100Min: null,
    hitTarget1: true, hitTarget2: false, hitStop: false, invalidated: false,
    setupGrade: "A+", contractGrade: "A+", entryGrade: "A+", exitGrade: "A", finalGrade: "A+",
    notes: "ITM LEAPS captured 27% underlying move with 1.8x leverage.",
    mistakeCategory: null, improvement: null,
    holdTimeMin: 120960,
  },
];

// ----- Analytics --------------------------------------------------

const GRADE_TO_NUM: Record<Grade, number> = { "A+": 6, A: 5, B: 4, C: 3, D: 2, F: 1 };

export function gradeToNum(g: Grade): number { return GRADE_TO_NUM[g]; }

export function numToGrade(n: number): Grade {
  if (n >= 5.5) return "A+";
  if (n >= 4.5) return "A";
  if (n >= 3.5) return "B";
  if (n >= 2.5) return "C";
  if (n >= 1.5) return "D";
  return "F";
}

export interface JoinedPick extends Pick {
  tracked: TrackedPick;
}

export function joinPicks(picks: Pick[], tracked: TrackedPick[]): JoinedPick[] {
  const by = new Map(tracked.map(t => [t.pickId, t]));
  return picks
    .filter(p => by.has(p.id))
    .map(p => ({ ...p, tracked: by.get(p.id)! }));
}

export const ALL_DEMO: JoinedPick[] = joinPicks(DEMO_PICKS, DEMO_TRACKED);

export interface SummaryMetrics {
  totalTracked: number;
  winRate: number;
  avgReturn: number;
  medianReturn: number;
  bestTradePct: number;
  worstTradePct: number;
  avgHoldTimeMin: number;
  avgMaxFavorable: number;
  avgMaxDrawdown: number;
  avgScoreWinners: number;
  avgScoreLosers: number;
  bestSetup: string;
  worstSetup: string;
  bestTicker: string;
  worstTicker: string;
  bestExpirationRange: string;
  bestDeltaRange: string;
  bestDteRange: string;
  bestMarketRegime: string;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function bestByGroup<T>(items: T[], key: (t: T) => string, value: (t: T) => number): { best: string; worst: string } {
  const buckets = new Map<string, number[]>();
  items.forEach(it => {
    const k = key(it);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(value(it));
  });
  let best = "—", worst = "—", bestAvg = -Infinity, worstAvg = Infinity;
  buckets.forEach((vals, k) => {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg > bestAvg) { bestAvg = avg; best = k; }
    if (avg < worstAvg) { worstAvg = avg; worst = k; }
  });
  return { best, worst };
}

export function computeSummary(items: JoinedPick[]): SummaryMetrics {
  if (!items.length) {
    return {
      totalTracked: 0, winRate: 0, avgReturn: 0, medianReturn: 0,
      bestTradePct: 0, worstTradePct: 0, avgHoldTimeMin: 0,
      avgMaxFavorable: 0, avgMaxDrawdown: 0,
      avgScoreWinners: 0, avgScoreLosers: 0,
      bestSetup: "—", worstSetup: "—", bestTicker: "—", worstTicker: "—",
      bestExpirationRange: "—", bestDeltaRange: "—", bestDteRange: "—", bestMarketRegime: "—",
    };
  }
  const returns = items.map(i => i.tracked.finalReturnPct);
  const winners = items.filter(i => i.tracked.finalReturnPct > 0);
  const losers = items.filter(i => i.tracked.finalReturnPct <= 0);
  const setup = bestByGroup(items, i => i.setupType, i => i.tracked.finalReturnPct);
  const ticker = bestByGroup(items, i => i.ticker, i => i.tracked.finalReturnPct);
  const dteRange = bestByGroup(items, i => bucketDte(i.dte), i => i.tracked.finalReturnPct);
  const deltaRange = bestByGroup(items, i => bucketDelta(Math.abs(i.delta)), i => i.tracked.finalReturnPct);
  const regime = bestByGroup(items, i => i.marketRegime, i => i.tracked.finalReturnPct);

  return {
    totalTracked: items.length,
    winRate: winners.length / items.length,
    avgReturn: returns.reduce((a, b) => a + b, 0) / returns.length,
    medianReturn: median(returns),
    bestTradePct: Math.max(...returns),
    worstTradePct: Math.min(...returns),
    avgHoldTimeMin: items.reduce((a, b) => a + b.tracked.holdTimeMin, 0) / items.length,
    avgMaxFavorable: items.reduce((a, b) => a + b.tracked.maxGainPct, 0) / items.length,
    avgMaxDrawdown: items.reduce((a, b) => a + b.tracked.maxDrawdownPct, 0) / items.length,
    avgScoreWinners: winners.length ? winners.reduce((a, b) => a + b.aiScore, 0) / winners.length : 0,
    avgScoreLosers: losers.length ? losers.reduce((a, b) => a + b.aiScore, 0) / losers.length : 0,
    bestSetup: setup.best, worstSetup: setup.worst,
    bestTicker: ticker.best, worstTicker: ticker.worst,
    bestExpirationRange: dteRange.best,
    bestDeltaRange: deltaRange.best,
    bestDteRange: dteRange.best,
    bestMarketRegime: regime.best,
  };
}

export function bucketDte(dte: number): string {
  if (dte <= 13) return "7–13";
  if (dte <= 20) return "14–20";
  if (dte <= 30) return "21–30";
  return "LEAPS";
}
export function bucketDelta(d: number): string {
  if (d < 0.25) return "0.10–0.24";
  if (d < 0.35) return "0.25–0.34";
  if (d < 0.50) return "0.35–0.50";
  if (d < 0.70) return "0.50–0.70";
  return "0.70+";
}
export function bucketIV(iv: number): string {
  if (iv < 0.40) return "<40";
  if (iv < 0.60) return "40–60";
  if (iv < 0.70) return "60–70";
  return "70+";
}
export function bucketTheta(t: number): string {
  if (t < 0.03) return "<3%";
  if (t < 0.05) return "3–5%";
  if (t < 0.08) return "5–8%";
  if (t < 0.10) return "8–10%";
  return ">10%";
}
export function bucketScore(s: number): string {
  if (s >= 90) return "90–100";
  if (s >= 80) return "80–89";
  if (s >= 70) return "70–79";
  if (s >= 60) return "60–69";
  return "<60";
}

export function groupStats<T>(
  items: T[],
  key: (t: T) => string,
  ret: (t: T) => number,
): { bucket: string; n: number; winRate: number; avgReturn: number }[] {
  const buckets = new Map<string, number[]>();
  items.forEach(i => {
    const k = key(i);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(ret(i));
  });
  return Array.from(buckets.entries()).map(([bucket, vals]) => ({
    bucket,
    n: vals.length,
    winRate: vals.filter(v => v > 0).length / vals.length,
    avgReturn: vals.reduce((a, b) => a + b, 0) / vals.length,
  }));
}
