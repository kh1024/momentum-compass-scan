import type { ExpirationBucket } from "./types";
import { expirationBucketFor } from "./optionQualityValidator";

export interface ExpirationMeta {
  expiration: string;
  dte: number;
  bucket: ExpirationBucket;
  callCount: number;
  putCount: number;
}

export function buildExpirationMeta(
  contracts: Array<{ expiration: string; dte: number; type: "CALL" | "PUT" }>,
): ExpirationMeta[] {
  const byExp = new Map<string, ExpirationMeta>();
  for (const c of contracts) {
    let row = byExp.get(c.expiration);
    if (!row) {
      row = {
        expiration: c.expiration,
        dte: c.dte,
        bucket: expirationBucketFor(c.dte),
        callCount: 0,
        putCount: 0,
      };
      byExp.set(c.expiration, row);
    }
    if (c.type === "CALL") row.callCount += 1;
    else if (c.type === "PUT") row.putCount += 1;
  }
  return Array.from(byExp.values()).sort(
    (a, b) => Date.parse(`${a.expiration}T00:00:00Z`) - Date.parse(`${b.expiration}T00:00:00Z`),
  );
}
