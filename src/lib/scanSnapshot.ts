/**
 * Dynamic-import shim for the client-only scan-snapshot module.
 *
 * The actual localStorage logic lives in `scanSnapshot.client.ts`, which
 * TanStack's import-protection plugin keeps out of the SSR/router bundle.
 * Call sites import THIS module and use `loadSnapshotModule()` inside
 * `useEffect` so the heavy module is only fetched in the browser.
 */
import type {
  ScanSnapshot as ScanSnapshotType,
  loadScanSnapshot as LoadScan,
  saveScanSnapshot as SaveScan,
  loadOptionsSnapshot as LoadOpts,
  saveOptionsSnapshot as SaveOpts,
  getSnapshotAge as GetAge,
} from "./scanSnapshot.client";

export type ScanSnapshot = ScanSnapshotType;

export interface SnapshotModule {
  loadScanSnapshot: typeof LoadScan;
  saveScanSnapshot: typeof SaveScan;
  loadOptionsSnapshot: typeof LoadOpts;
  saveOptionsSnapshot: typeof SaveOpts;
  getSnapshotAge: typeof GetAge;
}

let cached: Promise<SnapshotModule> | null = null;

/**
 * Returns the snapshot module. Resolves to `null` on the server so callers
 * can short-circuit safely. On the client, the module is loaded once and
 * cached for subsequent calls.
 */
export function loadSnapshotModule(): Promise<SnapshotModule | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!cached) {
    cached = import("./scanSnapshot.client").then((m) => ({
      loadScanSnapshot: m.loadScanSnapshot,
      saveScanSnapshot: m.saveScanSnapshot,
      loadOptionsSnapshot: m.loadOptionsSnapshot,
      saveOptionsSnapshot: m.saveOptionsSnapshot,
      getSnapshotAge: m.getSnapshotAge,
    }));
  }
  return cached;
}
