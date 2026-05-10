import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listScanRuns = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("scan_runs")
    .select("scan_id, started_at, finished_at, duration_ms, live_count, rate_limited, error")
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getScanRun = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ scanId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("scan_runs")
      .select("*")
      .eq("scan_id", data.scanId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });
