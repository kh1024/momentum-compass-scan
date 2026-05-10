import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProviderStatus } from "@/lib/quote.functions";
import { getNovaStatus } from "@/lib/nova.functions";
import {
  getMassiveStatus,
  setMassiveEnabledFn,
  getRateLimitLog,
  clearRateLimitLog,
  getScannerSettingsFn,
  updateScannerSettingsFn,
} from "@/lib/massive.functions";
import { useRiskFilters } from "@/hooks/useRiskFilters";
import { PRESET_ORDER } from "@/lib/riskFilters";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Momentum Options Scanner" }] }),
  component: Settings,
});

const PROVIDER_LABELS: Record<string, string> = {
  massive: "Massive (Quotes)",
  public: "Public.com (Quotes)",
  finnhub: "Finnhub (Quotes)",
  yahoo: "Yahoo Finance (Quotes)",
  stooq: "Stooq (EOD Quotes)",
};

function Settings() {
  const fetchStatus = useServerFn(getProviderStatus);
  const fetchNova = useServerFn(getNovaStatus);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["provider-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 60_000,
  });
  const { data: nova } = useQuery({
    queryKey: ["nova-status"],
    queryFn: () => fetchNova(),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const fetchMassive = useServerFn(getMassiveStatus);
  const toggleMassive = useServerFn(setMassiveEnabledFn);
  const qc = useQueryClient();
  const { data: massive } = useQuery({
    queryKey: ["massive-status"],
    queryFn: () => fetchMassive(),
    refetchInterval: 10_000,
  });
  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => toggleMassive({ data: { enabled } }),
    onSuccess: (s) => qc.setQueryData(["massive-status"], s),
  });
  const fetchRateLog = useServerFn(getRateLimitLog);
  const clearRateLog = useServerFn(clearRateLimitLog);
  const { data: rateLog } = useQuery({
    queryKey: ["rate-limit-log"],
    queryFn: () => fetchRateLog(),
    refetchInterval: 10_000,
  });
  const clearLogMutation = useMutation({
    mutationFn: () => clearRateLog(),
    onSuccess: () => qc.setQueryData(["rate-limit-log"], { events: [] }),
  });
  const fetchScannerSettings = useServerFn(getScannerSettingsFn);
  const updateScannerSettings = useServerFn(updateScannerSettingsFn);
  const { data: scannerSettings } = useQuery({
    queryKey: ["scanner-settings"],
    queryFn: () => fetchScannerSettings(),
  });
  const settingsMutation = useMutation({
    mutationFn: (patch: Record<string, number | boolean>) => updateScannerSettings({ data: patch }),
    onSuccess: (settings) => qc.setQueryData(["scanner-settings"], settings),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Live data sources, provider health, and scanner thresholds.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          {isFetching ? "Refreshing…" : "Refresh status"}
        </button>
      </header>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-4">
          <span className={massive?.enabled ? "text-[var(--color-bull)]" : "text-muted-foreground"}>
            {massive?.enabled ? "◉" : "⊘"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Massive (Options + Quotes backbone)</div>
            <div className="text-xs text-muted-foreground truncate">
              Throttled to {massive?.rateLimitPerMin ?? 75} req/min to stay under plan limits
              {massive?.enabled
                ? massive?.rateLimited
                  ? ` · Cooling down ${Math.ceil((massive.remainingMs ?? 0) / 1000)}s`
                  : massive?.snapshotDisabled
                    ? ` · ${massive.snapshotDisabledReason ?? "Snapshot off — using prev-close"}`
                    : " · Live"
                : " · Disabled in Settings — no requests sent"}
            </div>
          </div>
          <div className="text-right text-xs mono leading-tight">
            <div className="font-semibold">{massive?.requestsLastMinute ?? 0}<span className="text-muted-foreground">/60s</span></div>
            <div className={massive?.enabled ? "text-[var(--color-bull)]" : "text-muted-foreground"}>
              {massive?.enabled ? "ON" : "OFF"}
            </div>
          </div>
          <button
            onClick={() => toggleMutation.mutate(!massive?.enabled)}
            disabled={toggleMutation.isPending || !massive?.configured}
            className={`min-w-[64px] rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
              massive?.enabled
                ? "border-[var(--color-bull)] text-[var(--color-bull)] hover:bg-[var(--color-bull)]/10"
                : "border-border text-muted-foreground hover:bg-muted"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {toggleMutation.isPending ? "…" : massive?.enabled ? "On" : "Off"}
          </button>
        </div>
        {!massive?.configured && (
          <p className="mt-2 text-[11px] text-[var(--color-watch)]">
            MASSIVE_API_KEY not set — toggle disabled.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Data Sources</h2>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {data?.anyLive ? "● Live data flowing" : "○ Demo only"}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Quote consensus prefers the freshest source. Free providers (Yahoo, Stooq) require no key.
        </p>
        <ul className="mt-3 space-y-1.5">
          {isLoading && <li className="text-xs text-muted-foreground">Probing providers…</li>}
          {data?.providers.map(p => (
            <li
              key={p.source}
              className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <span className={p.ok ? "text-[var(--color-bull)]" : p.configured ? "text-[var(--color-bear)]" : "text-muted-foreground"}>
                {p.ok ? "●" : p.configured ? "✕" : "○"}
              </span>
              <div className="flex-1">
                <div className="font-semibold">{PROVIDER_LABELS[p.source] ?? p.source}</div>
                <div className="text-xs text-muted-foreground">{p.note}{p.error ? ` · ${p.error}` : ""}</div>
              </div>
              <div className="text-right text-xs mono">
                <div className="text-muted-foreground">{p.records}/probe</div>
                <div className={p.ok ? "text-[var(--color-bull)]" : "text-muted-foreground"}>
                  {p.latencyMs != null ? `${p.latencyMs}ms` : "—"}
                </div>
              </div>
              <span className={`min-w-[60px] text-right text-[10px] font-semibold uppercase tracking-wider ${
                p.ok ? "text-[var(--color-bull)]" : p.configured ? "text-[var(--color-bear)]" : "text-[var(--color-watch)]"
              }`}>
                {p.ok ? "OK" : p.configured ? "Error" : "Off"}
              </span>
            </li>
          ))}
          <li className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
            <span className={nova?.ok ? "text-[var(--color-bull)]" : nova?.configured ? "text-[var(--color-bear)]" : "text-muted-foreground"}>
              {nova?.ok ? "●" : nova?.configured ? "✕" : "○"}
            </span>
            <div className="flex-1">
              <div className="font-semibold">Lovable AI Gateway</div>
              <div className="text-xs text-muted-foreground">
                Nova explanations · Routed via gateway — no key needed
                {nova?.error ? ` · ${nova.error}` : ""}
              </div>
            </div>
            <div className="text-right text-xs mono">
              <div className="text-muted-foreground">{nova?.model ?? "—"}</div>
              <div className={nova?.ok ? "text-[var(--color-bull)]" : "text-muted-foreground"}>
                {nova?.latencyMs != null ? `${nova.latencyMs}ms` : "—"}
              </div>
            </div>
            <span className={`min-w-[60px] text-right text-[10px] font-semibold uppercase tracking-wider ${
              nova?.ok ? "text-[var(--color-bull)]" : nova?.configured ? "text-[var(--color-bear)]" : "text-[var(--color-watch)]"
            }`}>
              {nova?.ok ? "OK" : nova?.configured ? "Error" : "Off"}
            </span>
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Rate-Limit Log</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Last {rateLog?.events.length ?? 0} provider 429 events (in-memory, per server instance).
            </p>
          </div>
          <button
            onClick={() => clearLogMutation.mutate()}
            disabled={clearLogMutation.isPending || (rateLog?.events.length ?? 0) === 0}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            Clear
          </button>
        </div>
        {(rateLog?.events.length ?? 0) === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground italic">No 429 events recorded.</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-md border border-border">
            <table className="w-full text-xs mono">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">Time</th>
                  <th className="px-2 py-1.5 text-left">Provider</th>
                  <th className="px-2 py-1.5 text-left">Context</th>
                  <th className="px-2 py-1.5 text-right">Retry</th>
                  <th className="px-2 py-1.5 text-right">Source</th>
                </tr>
              </thead>
              <tbody>
                {rateLog?.events.map((e, i) => (
                  <tr key={`${e.ts}-${i}`} className="border-t border-border">
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
                    </td>
                    <td className="px-2 py-1.5 font-semibold">{e.provider}</td>
                    <td className="px-2 py-1.5 truncate max-w-[220px]" title={e.context}>{e.context}</td>
                    <td className="px-2 py-1.5 text-right text-[var(--color-bear)]">
                      {Math.ceil(e.retryAfterMs / 1000)}s
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">{e.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Full Scanner Refresh</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Controls how often the scanner reruns and reranks all option contracts. Quote refresh runs separately and never replaces selected contracts.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {([
            ["Off / Manual only", 0],
            ["5 min", 5 * 60_000],
            ["10 min", 10 * 60_000],
            ["15 min", 15 * 60_000],
          ] as const).map(([lbl, ms]) => {
            const cur = scannerSettings?.fullScanIntervalMs ?? 10 * 60_000;
            const active = cur === ms;
            return (
              <button
                key={lbl}
                onClick={() => settingsMutation.mutate({ fullScanIntervalMs: ms })}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "border-[var(--color-bull)] bg-[var(--color-bull)]/10 text-[var(--color-bull)]"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {lbl}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Default: 10 min. Manual scans always allowed via "Run scan now".</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Scanner API Controls</h2>
        <p className="mt-1 text-xs text-muted-foreground">Throttle Massive requests and tune cache windows so scans stay live without 429 storms.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <SettingNumber label="Max concurrent requests" value={scannerSettings?.maxConcurrentRequests ?? 2} min={1} max={6} onChange={(v) => settingsMutation.mutate({ maxConcurrentRequests: v })} />
          <SettingNumber label="Quote cache TTL seconds" value={Math.round((scannerSettings?.quoteTtlMs ?? 60_000) / 1000)} min={10} max={1800} onChange={(v) => settingsMutation.mutate({ quoteTtlMs: v * 1000 })} />
          <SettingNumber label="Prev aggregate TTL minutes" value={Math.round((scannerSettings?.prevAggTtlMs ?? 900_000) / 60_000)} min={1} max={1440} onChange={(v) => settingsMutation.mutate({ prevAggTtlMs: v * 60_000 })} />
          <SettingNumber label="Option chain TTL seconds" value={Math.round((scannerSettings?.optionChainTtlMs ?? 45_000) / 1000)} min={10} max={600} onChange={(v) => settingsMutation.mutate({ optionChainTtlMs: v * 1000 })} />
          <SettingNumber label="Market regime TTL seconds" value={Math.round((scannerSettings?.marketRegimeTtlMs ?? 120_000) / 1000)} min={30} max={600} onChange={(v) => settingsMutation.mutate({ marketRegimeTtlMs: v * 1000 })} />
          <SettingNumber label="Max retries" value={scannerSettings?.maxRetries ?? 3} min={0} max={5} onChange={(v) => settingsMutation.mutate({ maxRetries: v })} />
          <SettingNumber label="Retry backoff max seconds" value={Math.round((scannerSettings?.retryBackoffMaxMs ?? 15_000) / 1000)} min={1} max={60} onChange={(v) => settingsMutation.mutate({ retryBackoffMaxMs: v * 1000 })} />
          <SettingNumber label="Max tickers per scan" value={scannerSettings?.maxTickersPerScan ?? 12} min={1} max={50} onChange={(v) => settingsMutation.mutate({ maxTickersPerScan: v })} />
        </div>
        <label className="mt-4 flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
          <span>Only scan finalists for options chains</span>
          <input
            type="checkbox"
            checked={scannerSettings?.scanFinalistsOnlyForOptions ?? true}
            onChange={(e) => settingsMutation.mutate({ scanFinalistsOnlyForOptions: e.target.checked })}
            className="h-4 w-4 accent-[var(--color-bull)]"
          />
        </label>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Optional Provider Keys</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Add these to expand fallbacks, news catalysts, and Reddit sentiment. Without them the scanner still runs on Massive + Yahoo + Stooq.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm mono">
          {["FINNHUB_API_KEY", "ALPHA_VANTAGE_API_KEY", "STOCKDATA_API_KEY", "FIRECRAWL_API_KEY"].map(k => (
            <li key={k} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-1.5">
              <span>{k}</span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-watch)]">Not connected</span>
            </li>
          ))}
        </ul>
      </section>

      <RiskFiltersPanel />
    </div>
  );
}

function RiskFiltersPanel() {
  // Lazy import-free local component keeps the route file self-contained.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useRiskFilters } = require("@/hooks/useRiskFilters") as typeof import("@/hooks/useRiskFilters");
  const { PRESET_ORDER } = require("@/lib/riskFilters") as typeof import("@/lib/riskFilters");
  const { filters, preset, applyPreset, setFilter, reset } = useRiskFilters();

  const presetTone: Record<string, string> = {
    Conservative: "border-[var(--color-bull)]/40 text-[var(--color-bull)]",
    Balanced: "border-border text-foreground",
    Aggressive: "border-[var(--color-watch)]/50 text-[var(--color-watch)]",
    Lotto: "border-[var(--color-bear)]/50 text-[var(--color-bear)]",
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Risk Filters</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These thresholds filter every list across the app — dashboard, scanner, and live trades.
            Pick a preset or fine-tune the controls below.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          Reset
        </button>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {PRESET_ORDER.map((p) => {
          const active = preset === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              className={`rounded-md border px-3 py-2 text-xs font-semibold transition ${
                active
                  ? `bg-background ${presetTone[p] ?? "border-border"} ring-1 ring-current`
                  : `bg-background/40 ${presetTone[p] ?? "border-border"} opacity-70 hover:opacity-100`
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <SettingNumber label="Max contract cost ($)" value={filters.maxContractCost} min={50} max={10000}
          onChange={(v) => setFilter("maxContractCost", v)} />
        <SettingNumber label="Min |delta|" value={filters.minDelta} min={0} max={1}
          onChange={(v) => setFilter("minDelta", v)} />
        <SettingNumber label="Max IV (0–1)" value={filters.maxIV} min={0} max={3}
          onChange={(v) => setFilter("maxIV", v)} />
        <SettingNumber label="Min OI" value={filters.minOI} min={0} max={100000}
          onChange={(v) => setFilter("minOI", v)} />
        <SettingNumber label="Min volume" value={filters.minVolume} min={0} max={100000}
          onChange={(v) => setFilter("minVolume", v)} />
        <SettingNumber label="Max theta burn %/day" value={filters.maxThetaBurnPct} min={0} max={1}
          onChange={(v) => setFilter("maxThetaBurnPct", v)} />
        <SettingNumber label="Min DTE" value={filters.minDTE} min={0} max={720}
          onChange={(v) => setFilter("minDTE", v)} />
        <SettingNumber label="Max DTE" value={filters.maxDTE} min={0} max={720}
          onChange={(v) => setFilter("maxDTE", v)} />
        <SettingNumber label="Max spread %" value={filters.maxSpreadPct} min={0} max={1}
          onChange={(v) => setFilter("maxSpreadPct", v)} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <ToggleRow label="Reddit layer" value={filters.allowReddit} onChange={(v) => setFilter("allowReddit", v)} />
        <ToggleRow label="LEAPS" value={filters.allowLeaps} onChange={(v) => setFilter("allowLeaps", v)} />
        <ToggleRow label="Puts" value={filters.allowPuts} onChange={(v) => setFilter("allowPuts", v)} />
        <ToggleRow label="YOLOs" value={filters.allowYolo} onChange={(v) => setFilter("allowYolo", v)} />
      </div>
    </section>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--color-bull)]"
      />
    </label>
  );
}


function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
      <span className="text-muted-foreground">{k}</span>
      <span className="mono font-semibold">{v}</span>
    </div>
  );
}

function SettingNumber({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded-md border border-border bg-card px-2 py-1 text-right mono"
      />
    </label>
  );
}
