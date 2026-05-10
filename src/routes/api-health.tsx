import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { clearApiHealthLog, getApiHealthLog } from "@/lib/massive.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/api-health")({
  head: () => ({ meta: [{ title: "API Health — Momentum Options Scanner" }] }),
  component: ApiHealth,
});

function ApiHealth() {
  const fetchLog = useServerFn(getApiHealthLog);
  const clearLog = useServerFn(clearApiHealthLog);
  const qc = useQueryClient();
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["api-health-log"],
    queryFn: () => fetchLog(),
    refetchInterval: 10_000,
  });
  const clearMutation = useMutation({
    mutationFn: () => clearLog(),
    onSuccess: () => qc.setQueryData(["api-health-log"], { events: [] }),
  });
  const events = data?.events ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">API Health</h1>
          <p className="text-sm text-muted-foreground">Massive and chain request audit trail with cache, retry, and rate-limit status.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted">
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
          <button
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending || events.length === 0}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </header>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-xs mono">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Method</th>
                <th className="px-3 py-2 text-left">Endpoint / URL</th>
                <th className="px-3 py-2 text-left">Ticker</th>
                <th className="px-3 py-2 text-right">Status</th>
                <th className="px-3 py-2 text-right">Retry-After</th>
                <th className="px-3 py-2 text-right">Latency</th>
                <th className="px-3 py-2 text-right">Cached</th>
                <th className="px-3 py-2 text-right">Retries</th>
                <th className="px-3 py-2 text-right">Rate limited</th>
                <th className="px-3 py-2 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">{new Date(e.timestamp).toLocaleTimeString([], { hour12: false })}</td>
                  <td className="px-3 py-2 font-semibold">{e.method ?? "GET"}</td>
                  <td className="max-w-[360px] px-3 py-2" title={e.url ?? e.endpoint}>
                    <div className="truncate">{e.endpoint}</div>
                    {e.url && e.url !== e.endpoint && <div className="truncate text-[10px] text-muted-foreground">{e.url}</div>}
                  </td>
                  <td className="px-3 py-2 font-semibold">{e.ticker ?? "—"}</td>
                  <td className={cn("px-3 py-2 text-right", e.statusCode && e.statusCode >= 400 ? "text-[var(--color-bear)]" : "text-[var(--color-bull)]")}>
                    {e.statusCode ?? "—"}{e.statusText ? <span className="ml-1 text-[10px] text-muted-foreground">{e.statusText}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{e.retryAfterMs != null ? `${e.retryAfterMs}ms` : "—"}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{e.responseTimeMs}ms</td>
                  <td className="px-3 py-2 text-right">{e.cached ? "true" : "false"}</td>
                  <td className="px-3 py-2 text-right">{e.retryCount}</td>
                  <td className={cn("px-3 py-2 text-right", e.rateLimited ? "text-[var(--color-watch)]" : "text-muted-foreground")}>{e.rateLimited ? "true" : "false"}</td>
                  <td className="max-w-[300px] truncate px-3 py-2 text-muted-foreground" title={e.errorMessage ?? undefined}>{e.errorMessage ?? "—"}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">No API events recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}