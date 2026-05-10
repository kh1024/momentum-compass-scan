/**
 * Support/Resistance Engine — placeholder pure functions.
 * Replace internals with real OHLCV-driven logic when API data is wired.
 */
import type { Levels } from "./types";

export interface OHLCBar { o: number; h: number; l: number; c: number; v: number; t: number }

export function computeLevels(price: number, bars: OHLCBar[]): Levels {
  // Naive heuristic placeholder; mock-data layer provides hand-tuned values.
  const recent = bars.slice(-30);
  const highs = recent.map(b => b.h).sort((a, b) => b - a);
  const lows = recent.map(b => b.l).sort((a, b) => a - b);
  const baseHigh = highs[2] ?? price * 1.04;
  const baseLow = lows[2] ?? price * 0.94;
  return {
    s1: price * 0.985, s2: baseLow, s3: price * 0.92,
    r1: price * 1.015, r2: baseHigh, r3: price * 1.08,
    pivot: (baseHigh + baseLow) / 2,
    baseHigh, baseLow, baseMid: (baseHigh + baseLow) / 2,
    dma20: price * 0.99, dma50: price * 0.96, dma200: price * 0.88,
    vwap: price * 0.995,
  };
}

export function entryTriggerFromLevels(direction: "CALL" | "PUT", levels: Levels): string {
  return direction === "CALL"
    ? `Reclaim pivot ${levels.pivot.toFixed(2)} or break base high ${levels.baseHigh.toFixed(2)} on volume`
    : `Lose ${levels.s1.toFixed(2)} support or reject ${levels.r1.toFixed(2)} on volume`;
}

export function invalidationFromLevels(direction: "CALL" | "PUT", levels: Levels): string {
  return direction === "CALL"
    ? `Lose base low ${levels.baseLow.toFixed(2)} / 50DMA ${levels.dma50.toFixed(2)}`
    : `Reclaim ${levels.r1.toFixed(2)} / 20DMA ${levels.dma20.toFixed(2)}`;
}
