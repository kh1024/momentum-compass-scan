import type { OptionContract } from "./types";

export type ContractTier = "buyNowEligible" | "watchlistOnly" | "yoloOnly" | "avoid";

export interface ContractQualityParts {
  delta: number;
  theta: number;
  iv: number;
  spread: number;
  oi: number;
  volume: number;
}

export interface ContractQualityResult {
  score: number; // 0-35
  parts: ContractQualityParts;
  blockers: string[];
  downgrades: string[];
  tier: ContractTier;
}

const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export interface QualityOpts {
  isLeaps?: boolean;
  isYolo?: boolean;
}

/**
 * Compute Contract Quality Score (0-35) with hard blocker tiering.
 * Bands strictly per scanner spec.
 */
export function scoreContractQuality(c: OptionContract, opts: QualityOpts = {}): ContractQualityResult {
  const { isLeaps = false, isYolo = false } = opts;
  const blockers: string[] = [];
  const downgrades: string[] = [];
  let tier: ContractTier = "buyNowEligible";

  const downgradeTier = (next: ContractTier) => {
    const order: ContractTier[] = ["buyNowEligible", "watchlistOnly", "yoloOnly", "avoid"];
    if (order.indexOf(next) > order.indexOf(tier)) tier = next;
  };

  // Required field presence — missing data = avoid
  const missing: string[] = [];
  if (!num(c.delta)) missing.push("delta");
  if (!num(c.theta)) missing.push("theta");
  if (!num(c.iv) || c.iv <= 0) missing.push("iv");
  if (!num(c.bid) || c.bid < 0) missing.push("bid");
  if (!num(c.ask) || c.ask <= 0) missing.push("ask");
  if (!num(c.openInterest)) missing.push("openInterest");
  if (!num(c.volume)) missing.push("volume");
  if (missing.length > 0) {
    for (const m of missing) blockers.push(`Missing ${m}`);
    downgradeTier("avoid");
    return {
      score: 0,
      parts: { delta: 0, theta: 0, iv: 0, spread: 0, oi: 0, volume: 0 },
      blockers,
      downgrades,
      tier,
    };
  }

  const absDelta = Math.abs(c.delta);
  const ivPct = c.iv * 100;
  const spreadPct = (c.spreadPct ?? 0) * 100;
  const thetaPct = (c.thetaBurnPct ?? 0) * 100;

  // ---- Delta /8
  let delta = 0;
  if (isLeaps) {
    if (absDelta >= 0.6 && absDelta <= 0.8) delta = 8;
    else if (absDelta >= 0.45) delta = 5;
    else delta = 2;
  } else {
    if (absDelta >= 0.35 && absDelta <= 0.5) delta = 8;
    else if ((absDelta >= 0.25 && absDelta < 0.35) || (absDelta > 0.5 && absDelta <= 0.6)) delta = 5;
    else if (absDelta >= 0.15 && absDelta < 0.25) {
      delta = 2;
      blockers.push(`Delta ${absDelta.toFixed(2)} < 0.25 — no Buy Now`);
      downgradeTier("yoloOnly");
    } else if (absDelta < 0.15) {
      delta = 0;
      blockers.push(`Delta ${absDelta.toFixed(2)} < 0.15 — YOLO only`);
      downgradeTier("yoloOnly");
    } else if (absDelta > 0.75) {
      delta = 2;
      downgrades.push(`Delta ${absDelta.toFixed(2)} > 0.75 — too deep ITM unless LEAPS`);
    } else {
      delta = 3;
    }
  }

  // ---- Theta /7
  let theta = 0;
  if (thetaPct < 3) theta = 7;
  else if (thetaPct <= 5) theta = 5;
  else if (thetaPct <= 8) theta = 3;
  else {
    theta = 0;
    blockers.push(`Theta burn ${thetaPct.toFixed(1)}%/d > 8% — no Buy Now`);
    downgradeTier("watchlistOnly");
    if (thetaPct > 10) {
      downgradeTier("yoloOnly");
    }
  }
  if (isLeaps && theta < 5) theta = 5; // LEAPS theta gate relaxed

  // ---- IV /6
  let iv = 0;
  if (ivPct < 45) iv = 6;
  else if (ivPct <= 60) iv = 5;
  else if (ivPct <= 70) iv = 3;
  else if (ivPct <= 85) {
    iv = 1;
    downgrades.push(`IV ${ivPct.toFixed(0)}% high`);
  } else {
    iv = 0;
    blockers.push(`IV ${ivPct.toFixed(0)}% > 85% — avoid unless YOLO`);
    downgradeTier("yoloOnly");
  }

  // ---- Spread /6
  let spread = 0;
  if (spreadPct < 5) spread = 6;
  else if (spreadPct <= 10) spread = 5;
  else if (spreadPct <= 15) spread = 3;
  else if (spreadPct <= 20) {
    spread = 0;
    blockers.push(`Spread ${spreadPct.toFixed(0)}% > 15% — no Buy Now`);
    downgradeTier("watchlistOnly");
  } else {
    spread = 0;
    blockers.push(`Spread ${spreadPct.toFixed(0)}% > 20% — avoid`);
    downgradeTier("avoid");
  }

  // ---- OI /4
  let oi = 0;
  if (c.openInterest >= 1000) oi = 4;
  else if (c.openInterest >= 500) oi = 3;
  else if (c.openInterest >= 300) {
    oi = 1;
    if (!isLeaps) downgrades.push(`OI ${c.openInterest} weak`);
  } else {
    oi = 0;
    if (!isLeaps) {
      blockers.push(`OI ${c.openInterest} < 300 — avoid disciplined trade`);
      downgradeTier("avoid");
    } else {
      downgrades.push(`OI ${c.openInterest} low for LEAPS`);
    }
  }

  // ---- Volume /4
  let volume = 0;
  if (c.volume >= 1000) volume = 4;
  else if (c.volume >= 250) volume = 3;
  else if (c.volume >= 100) volume = 2;
  else {
    volume = 0;
    blockers.push(`Volume ${c.volume} < 100 — avoid disciplined trade`);
    downgradeTier("avoid");
  }

  // Non-yolo extra gates
  if (!isYolo && !isLeaps) {
    if (absDelta < 0.25) downgradeTier("watchlistOnly");
  }

  const score = delta + theta + iv + spread + oi + volume;
  return {
    score,
    parts: { delta, theta, iv, spread, oi, volume },
    blockers,
    downgrades,
    tier,
  };
}
