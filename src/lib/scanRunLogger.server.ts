import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ScanPickInput = {
  ticker: string;
  direction: "CALL" | "PUT";
  isLeaps?: boolean;
  isYolo?: boolean;
};

export interface ScanRunRecord {
  scanId: string;
  startedAt: number;
  picksInput: ScanPickInput[];
  rawResponses: Record<string, unknown>;
  mappingSteps: Record<string, unknown>;
  filterDecisions: Record<string, unknown>;
  finalPicks: Record<string, unknown>;
}

export function newScanId(): string {
  return `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createScanRun(picksInput: ScanPickInput[]): ScanRunRecord {
  return {
    scanId: newScanId(),
    startedAt: Date.now(),
    picksInput,
    rawResponses: {},
    mappingSteps: {},
    filterDecisions: {},
    finalPicks: {},
  };
}

export async function persistScanRun(
  run: ScanRunRecord,
  summary: { rateLimited: boolean; liveCount: number; error?: string },
): Promise<void> {
  try {
    const finishedAt = Date.now();
    await supabaseAdmin.from("scan_runs").insert({
      scan_id: run.scanId,
      started_at: new Date(run.startedAt).toISOString(),
      finished_at: new Date(finishedAt).toISOString(),
      duration_ms: finishedAt - run.startedAt,
      picks_input: run.picksInput as never,
      raw_responses: run.rawResponses as never,
      mapping_steps: run.mappingSteps as never,
      filter_decisions: run.filterDecisions as never,
      final_picks: run.finalPicks as never,
      rate_limited: summary.rateLimited,
      live_count: summary.liveCount,
      error: summary.error ?? null,
    });
  } catch (e) {
    console.warn("[scanRunLogger] persist failed", e);
  }
}
