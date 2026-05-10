/** Shared (client-safe) types for contract cross-source verification. */
export type FieldStatus = "match" | "mismatch" | "missing";

export interface ContractVerification {
  secondarySource: "finnhub" | "massive";
  secondaryAvailable: boolean;
  contractExists: boolean;
  fields: Partial<Record<
    "expiration" | "strike" | "bid" | "ask" | "openInterest" | "volume"
      | "iv" | "delta" | "gamma" | "theta" | "vega",
    { status: FieldStatus; primary?: number | string; secondary?: number | string }
  >>;
  allMatch: boolean;
  disputed: string[];
}
