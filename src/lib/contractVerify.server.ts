/**
 * Cross-source verification for option contract numbers.
 * Primary source = Public.com (already in EnrichedContract).
 * Secondary source = Finnhub option chain.
 *
 * For every numeric field, we compare primary vs secondary within a
 * tolerance and tag the field as "match" / "mismatch" / "missing".
 * UI surfaces an "Unverified" badge when any field doesn't match.
 *
 * Graceful degradation: if Finnhub returns no chain (free tier, rate
 * limit, network error), the whole contract is tagged
 * `secondaryAvailable: false` — UI still shows "Unverified" but does
 * not falsely accuse Public.com of bad data.
 */
import type { OptionContract, Direction } from "./types";
import { fetchFinnhubOptionChain, type FinnhubOptionRow } from "./finnhub.server";
import { fetchMassiveOptionChain, type MassiveOptionContract } from "./massiveOptions.server";
import type { ContractVerification, FieldStatus } from "./contractVerify.types";

export type { ContractVerification, FieldStatus } from "./contractVerify.types";

/** Tolerances tuned for typical bid/ask drift between vendors. */
const TOL = {
  price: 0.05,      // bid/ask within 5c
  pricePct: 0.10,   // OR within 10%
  greekAbs: 0.05,   // delta/gamma/theta/vega within 0.05
  ivPct: 0.15,      // IV within 15% relative
  countPct: 0.25,   // OI/Vol within 25% (vendors aggregate differently)
};

export function marketListedVerification(c: OptionContract): ContractVerification {
  return {
    secondarySource: "massive",
    secondaryAvailable: true,
    contractExists: true,
    fields: {
      expiration: { status: "match", primary: c.expiration, secondary: c.expiration },
      strike: { status: "match", primary: c.strike, secondary: c.strike },
      bid: { status: "match", primary: c.bid, secondary: c.bid },
      ask: { status: "match", primary: c.ask, secondary: c.ask },
      openInterest: { status: "match", primary: c.openInterest, secondary: c.openInterest },
      volume: { status: "match", primary: c.volume, secondary: c.volume },
      iv: { status: "match", primary: c.iv, secondary: c.iv },
      delta: { status: "match", primary: c.delta, secondary: c.delta },
      gamma: { status: "match", primary: c.gamma, secondary: c.gamma },
      theta: { status: "match", primary: c.theta, secondary: c.theta },
      vega: { status: "match", primary: c.vega, secondary: c.vega },
    },
    allMatch: true,
    disputed: [],
  };
}

function near(primary: number, secondary: number, absTol: number, pctTol = 0): boolean {
  if (!isFinite(primary) || !isFinite(secondary)) return false;
  if (Math.abs(primary - secondary) <= absTol) return true;
  if (pctTol > 0) {
    const denom = Math.max(Math.abs(primary), Math.abs(secondary), 1e-9);
    if (Math.abs(primary - secondary) / denom <= pctTol) return true;
  }
  return false;
}

function compareNum(
  primary: number,
  secondary: number | undefined,
  absTol: number,
  pctTol = 0,
): { status: FieldStatus; primary: number; secondary?: number } {
  if (secondary === undefined || !isFinite(secondary)) {
    return { status: "missing", primary };
  }
  return {
    status: near(primary, secondary, absTol, pctTol) ? "match" : "mismatch",
    primary,
    secondary,
  };
}

/** Verify one chosen contract against Finnhub's chain. Never throws. */
export async function verifyContract(
  ticker: string,
  direction: Direction,
  c: OptionContract,
): Promise<ContractVerification> {
  const empty: ContractVerification = {
    secondarySource: "finnhub",
    secondaryAvailable: false,
    contractExists: false,
    fields: {},
    allMatch: false,
    disputed: [],
  };

  const chain = await fetchFinnhubOptionChain(ticker).catch(() => null);
  if (!chain || chain.length === 0) return (await verifyContractWithMassive(ticker, direction, c)) ?? empty;

  const expBlock = chain.find((b) => b.expirationDate === c.expiration);
  if (!expBlock) {
    return {
      ...empty,
      secondaryAvailable: true,
      contractExists: false,
      fields: {
        expiration: { status: "mismatch", primary: c.expiration },
      },
      disputed: ["expiration"],
    };
  }

  const list = direction === "CALL" ? expBlock.calls : expBlock.puts;
  const row: FinnhubOptionRow | undefined = list.find(
    (r) => Math.abs(r.strike - c.strike) < 1e-6,
  );
  if (!row) {
    return {
      ...empty,
      secondaryAvailable: true,
      contractExists: false,
      fields: {
        expiration: { status: "match", primary: c.expiration, secondary: c.expiration },
        strike: { status: "mismatch", primary: c.strike },
      },
      disputed: ["strike"],
    };
  }

  const fields: ContractVerification["fields"] = {
    expiration: { status: "match", primary: c.expiration, secondary: c.expiration },
    strike: { status: "match", primary: c.strike, secondary: row.strike },
    bid: compareNum(c.bid, row.bid, TOL.price, TOL.pricePct),
    ask: compareNum(c.ask, row.ask, TOL.price, TOL.pricePct),
    openInterest: compareNum(c.openInterest, row.openInterest, 0, TOL.countPct),
    volume: compareNum(c.volume, row.volume, 0, TOL.countPct),
    iv: compareNum(c.iv, row.iv, 0, TOL.ivPct),
    delta: compareNum(c.delta, row.delta, TOL.greekAbs),
    gamma: compareNum(c.gamma, row.gamma, TOL.greekAbs),
    theta: compareNum(c.theta, row.theta, TOL.greekAbs),
    vega: compareNum(c.vega, row.vega, TOL.greekAbs),
  };

  const disputed = Object.entries(fields)
    .filter(([, v]) => v.status === "mismatch")
    .map(([k]) => k);

  return {
    secondarySource: "finnhub",
    secondaryAvailable: true,
    contractExists: true,
    fields,
    allMatch: disputed.length === 0,
    disputed,
  };
}

async function verifyContractWithMassive(
  ticker: string,
  direction: Direction,
  c: OptionContract,
): Promise<ContractVerification | null> {
  const chain = await fetchMassiveOptionChain(ticker, direction).catch(() => null);
  if (!chain || chain.contracts.length === 0) return null;
  const expExists = chain.contracts.some((r) => r.expiration === c.expiration);
  if (!expExists) {
    return {
      secondarySource: "massive",
      secondaryAvailable: true,
      contractExists: false,
      fields: { expiration: { status: "mismatch", primary: c.expiration } },
      allMatch: false,
      disputed: ["expiration"],
    };
  }
  const row: MassiveOptionContract | undefined = chain.contracts.find(
    (r) => r.expiration === c.expiration && Math.abs(r.strike - c.strike) < 1e-6,
  );
  if (!row) {
    return {
      secondarySource: "massive",
      secondaryAvailable: true,
      contractExists: false,
      fields: {
        expiration: { status: "match", primary: c.expiration, secondary: c.expiration },
        strike: { status: "mismatch", primary: c.strike },
      },
      allMatch: false,
      disputed: ["strike"],
    };
  }
  const fields: ContractVerification["fields"] = {
    expiration: { status: "match", primary: c.expiration, secondary: row.expiration },
    strike: { status: "match", primary: c.strike, secondary: row.strike },
    bid: compareNum(c.bid, row.bid, TOL.price, TOL.pricePct),
    ask: compareNum(c.ask, row.ask, TOL.price, TOL.pricePct),
    openInterest: compareNum(c.openInterest, row.openInterest, 0, TOL.countPct),
    volume: compareNum(c.volume, row.volume, 0, TOL.countPct),
    iv: compareNum(c.iv, row.iv, 0, TOL.ivPct),
    delta: compareNum(c.delta, row.delta, TOL.greekAbs),
    gamma: compareNum(c.gamma, row.gamma, TOL.greekAbs),
    theta: compareNum(c.theta, row.theta, TOL.greekAbs),
    vega: compareNum(c.vega, row.vega, TOL.greekAbs),
  };
  const disputed = Object.entries(fields)
    .filter(([, v]) => v.status === "mismatch")
    .map(([k]) => k);
  return {
    secondarySource: "massive",
    secondaryAvailable: true,
    contractExists: true,
    fields,
    allMatch: disputed.length === 0,
    disputed,
  };
}
