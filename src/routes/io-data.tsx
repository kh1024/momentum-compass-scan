import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MOCK_CANDIDATES, MOCK_REGIME } from "@/lib/mockData";
import { enrichWithPublicChain, type EnrichmentResult } from "@/lib/chain.functions";
import { getScannerSettingsFn, getApiHealthLog } from "@/lib/massive.functions";
import type { TradeCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useRedditSentiment } from "@/hooks/useRedditSentiment";
import { applyLiveChain, applyLiveQuote, applyRedditSignal, finalizeCandidate } from "@/lib/applyLiveQuote";
import { expirationBucketFor } from "@/lib/optionQualityValidator";
import { entryModeFromSetup } from "@/lib/entryMode";
import { chainPickKey } from "@/lib/chainKeys";
import { runDisciplineGate, type DisciplineGateResult } from "@/lib/disciplineGate";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/io-data")({
  head: () => ({ meta: [{ title: "Data Inspector — Momentum Options Scanner" }] }),
  component: IOData,
});

// ── Validation badge types ────────────────────────────────────────────────────
type BadgeKind = "verified" | "calculated" | "cached" | "missing" | "unverified" | "invalid" | "synthetic" | "demo";

const BADGE_STYLE: Record<BadgeKind, string> = {
  verified:   "bg-[var(--color-bull)]/15 text-[var(--color-bull)] border-[var(--color-bull)]/30",
  calculated: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  cached:     "bg-amber-500/10 text-amber-400 border-amber-500/20",
  missing:    "bg-[var(--color-bear)]/15 text-[var(--color-bear)] border-[var(--color-bear)]/30",
  unverified: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  invalid:    "bg-[var(--color-bear)]/20 text-[var(--color-bear)] border-[var(--color-bear)]/40",
  synthetic:  "bg-purple-500/15 text-purple-400 border-purple-500/30",
  demo:       "bg-[var(--color-watch)]/10 text-[var(--color-watch)] border-[var(--color-watch)]/20",
};

function Badge({ kind, label }: { kind: BadgeKind; label?: string }) {
  const text = label ?? kind.toUpperCase();
  return (
    <span className={cn("rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider", BADGE_STYLE[kind])}>
      {text}
    </span>
  );
}

function contractBadge(c: TradeCandidate["contract"]): BadgeKind {
  if (c.source === "chain") return "verified";
  if (c.source === "mock-rescaled") return "calculated";
  return "demo";
}

// ── Validation rule check ─────────────────────────────────────────────────────
interface RuleResult { id: number; name: string; pass: boolean; detail: string }

function validateContractRules(t: TradeCandidate): RuleResult[] {
  const c = t.contract;
  const missing = c.missingFields ?? [];
  const isLeaps = t.setupType === "LEAPS";

  return [
    {
      id: 1, name: "Real option ticker exists",
      pass: !!c.occSymbol && !c.occSymbol.startsWith("MOCK"),
      detail: c.occSymbol ?? "—",
    },
    {
      id: 2, name: "Strike from options chain",
      pass: c.source === "chain",
      detail: c.source !== "chain" ? `SYNTHETIC — source: ${c.source}` : `$${c.strike}`,
    },
    {
      id: 3, name: "Expiration from options chain",
      pass: c.source === "chain",
      detail: c.source !== "chain" ? `SYNTHETIC — ${c.expiration}` : c.expiration,
    },
    {
      id: 4, name: "Bid/ask verified",
      pass: !missing.some(f => /quote|bid|ask|no-quote/.test(f)),
      detail: missing.some(f => /quote|bid|ask/.test(f)) ? `Missing: ${missing.filter(f => /quote|bid|ask/.test(f)).join(", ")}` : `$${c.bid.toFixed(2)} / $${c.ask.toFixed(2)}`,
    },
    {
      id: 5, name: "Greeks verified",
      pass: !missing.some(f => /delta|theta|iv/.test(f)),
      detail: missing.some(f => /delta|theta|iv/.test(f)) ? `Missing: ${missing.filter(f => /delta|theta|iv/.test(f)).join(", ")}` : `Δ${c.delta.toFixed(2)} IV${(c.iv * 100).toFixed(0)}%`,
    },
    {
      id: 6, name: "Volume is option volume (≥50)",
      pass: c.volume >= 50,
      detail: `${c.volume} contracts`,
    },
    {
      id: 7, name: "Open interest ≥100",
      pass: isLeaps || c.openInterest >= 100,
      detail: `${c.openInterest.toLocaleString()}`,
    },
    {
      id: 8, name: "DTE ≥ 7",
      pass: c.dte >= 7,
      detail: `${c.dte}d`,
    },
    {
      id: 9, name: "DTE valid for setup type",
      pass: isLeaps ? c.dte >= 180 : (c.dte >= 7 && c.dte <= 60),
      detail: isLeaps ? `${c.dte}d (LEAPS: 180+)` : `${c.dte}d (range: 7–60)`,
    },
    {
      id: 10, name: "Spread ≤ 15%",
      pass: c.spreadPct <= 0.15,
      detail: `${(c.spreadPct * 100).toFixed(1)}%`,
    },
    {
      id: 11, name: "Theta burn ≤ 8%/day",
      pass: isLeaps || c.thetaBurnPct <= 0.08,
      detail: `${(c.thetaBurnPct * 100).toFixed(2)}%/d`,
    },
    {
      id: 12, name: "Breakeven move ≤ 15%",
      pass: c.breakevenMovePct <= 0.15,
      detail: `${(c.breakevenMovePct * 100).toFixed(1)}%`,
    },
    {
      id: 13, name: "Not broker-confirm-required for Buy Now",
      pass: !c.brokerConfirmRequired,
      detail: c.brokerConfirmRequired ? "BROKER CONFIRMATION REQUIRED" : "OK",
    },
    {
      id: 14, name: "Cost ≤ $1,000",
      pass: (c.cost ?? c.ask * 100) <= 1000,
      detail: `$${(c.cost ?? c.ask * 100).toFixed(0)}`,
    },
    {
      id: 15, name: "Delta in range (0.20–0.70)",
      pass: Math.abs(c.delta) >= 0.20 && Math.abs(c.delta) <= 0.70,
      detail: `Δ${Math.abs(c.delta).toFixed(2)}`,
    },
  ];
}

// ── Copy helper ───────────────────────────────────────────────────────────────
function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return { copy, copied };
}

function CopyBtn({ data, label = "Copy JSON" }: { data: unknown; label?: string }) {
  const { copy, copied } = useCopy(JSON.stringify(data, null, 2));
  return (
    <button
      onClick={copy}
      className="rounded border border-border bg-card px-2.5 py-1 text-[10px] font-semibold text-muted-foreground transition hover:border-foreground/20 hover:text-foreground"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

// ── Section card ─────────────────────────────────────────────────────────────
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
function IOData() {
  const qc = useQueryClient();
  const enrichFn = useServerFn(enrichWithPublicChain);
  const fetchSettings = useServerFn(getScannerSettingsFn);
  const fetchLog = useServerFn(getApiHealthLog);

  const { data: scannerSettings } = useQuery({
    queryKey: ["scanner-settings"],
    queryFn: () => fetchSettings(),
    staleTime: 60_000,
  });

  const picks = useMemo(
    () => MOCK_CANDIDATES.map(c => ({
      ticker: c.ticker,
      direction: c.direction,
      isLeaps: c.setupType === "LEAPS",
      isYolo: c.setupType === "Reddit YOLO",
      entryMode: entryModeFromSetup(c.setupType),
      targetStrike: entryModeFromSetup(c.setupType) === "Breakout" ? c.levels.baseHigh : c.price,
    })),
    [],
  );

  const { data: chainData } = useQuery<EnrichmentResult>({
    queryKey: ["dashboard-chain", picks.map(p => `${p.ticker}:${p.direction}`).join(",")],
    queryFn: () => enrichFn({ data: { picks } }),
    enabled: picks.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: prev => prev,
  });

  const { data: healthLog } = useQuery({
    queryKey: ["api-health-log"],
    queryFn: () => fetchLog(),
    refetchInterval: 10_000,
  });

  const symbols = useMemo(() => Array.from(new Set(MOCK_CANDIDATES.map(c => c.ticker))), []);
  const { get: getLive } = useLiveQuotes(symbols);
  const { get: getReddit } = useRedditSentiment(symbols);

  const traces: { c: TradeCandidate; gate: DisciplineGateResult; rules: RuleResult[] }[] = useMemo(() => {
    const enriched = chainData?.enriched ?? {};
    return MOCK_CANDIDATES.map(c => {
      const isLeaps = c.setupType === "LEAPS";
      const isYolo = c.setupType === "Reddit YOLO";
      const base = applyRedditSignal(applyLiveQuote(c, getLive(c.ticker)), getReddit(c.ticker));
      const entryMode = entryModeFromSetup(c.setupType);
      const key = chainPickKey(c.ticker, c.direction, { isLeaps, isYolo, entryMode });
      const withChain = applyLiveChain(base, enriched[key] ?? null);
      const finalized = finalizeCandidate(withChain);
      const gate = runDisciplineGate(finalized, { extendedSwingEnabled: true });
      const merged: TradeCandidate = {
        ...finalized,
        score: gate.finalScore,
        finalScore: gate.finalScore,
        label: gate.displayLabel,
        originalLabel: gate.baseLabel !== gate.displayLabel ? gate.baseLabel : undefined,
        sectionRouted: gate.routedSection === "hidden" ? expirationBucketFor(finalized.contract.dte) : gate.routedSection,
        dteBucketLabel: expirationBucketFor(finalized.contract.dte),
        validationOk: gate.visible && gate.finalLabel !== "Avoid",
        validationReason: gate.reasons.join(" · "),
        buyNowEligible: gate.buyNowEligible,
        buyNowBlockers: gate.buyNowBlockers,
      };
      return { c: merged, gate, rules: validateContractRules(merged) };
    });
  }, [chainData, getLive, getReddit]);

  const visible = traces.filter(t => t.gate.visible);
  const rejected = traces.filter(t => !t.gate.visible);
  const finalCandidates = visible.filter(t => !["Avoid Ticker", "Avoid", "Avoid Contract"].includes(t.c.label));

  const regimeData = qc.getQueryData<{ live: boolean; quotes?: Record<string, { price: number; changePct: number }> }>(["regime-quotes"]);
  const scanDate = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const scanTime = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dataMode = chainData?.rateLimited ? "delayed" : chainData && Object.values(chainData.enriched).some(v => v !== null) ? "live" : "demo";

  const events = healthLog?.events ?? [];
  const apiStats = useMemo(() => ({
    total: events.length,
    success: events.filter(e => e.status >= 200 && e.status < 300).length,
    failed: events.filter(e => e.status >= 400).length,
    rate429: events.filter(e => e.status === 429).length,
    cached: events.filter(e => e.cached).length,
    avgMs: events.length ? Math.round(events.reduce((s, e) => s + (e.durationMs ?? 0), 0) / events.length) : 0,
  }), [events]);

  const scanInputsJson = {
    scanId: `scan-${Date.now().toString(36)}`,
    scanDate, scanTime,
    dataMode,
    tickers: symbols,
    tickerCount: symbols.length,
    settings: scannerSettings ?? {},
    marketInputs: {
      spy: regimeData?.quotes?.["SPY"] ?? MOCK_REGIME.spy,
      qqq: regimeData?.quotes?.["QQQ"] ?? MOCK_REGIME.qqq,
      smh: regimeData?.quotes?.["SMH"] ?? MOCK_REGIME.smh,
      vix: MOCK_REGIME.vix,
      bias: MOCK_REGIME.bias,
    },
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Data Inspector</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Validate scanner inputs, API responses, contract mapping, filters, scores, and final picks.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge kind={dataMode === "live" ? "verified" : dataMode === "delayed" ? "unverified" : "demo"} label={dataMode.toUpperCase()} />
            <span className="text-xs text-muted-foreground">{scanDate} · {scanTime}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{MOCK_CANDIDATES.length} inputs → {visible.length} visible → {finalCandidates.length} tradeable</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyBtn data={scanInputsJson} label="Copy Scan JSON" />
          <CopyBtn data={traces.map(t => ({ ticker: t.c.ticker, gate: t.gate, rules: t.rules }))} label="Copy Full Trace" />
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="inputs">
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="inputs">Scan Inputs</TabsTrigger>
          <TabsTrigger value="raw-api">Raw API Data</TabsTrigger>
          <TabsTrigger value="normalized">Normalized Data</TabsTrigger>
          <TabsTrigger value="filters">
            Contract Filters
            <span className="ml-1 rounded bg-[var(--color-bull)]/20 px-1 text-[9px] text-[var(--color-bull)]">{visible.length}</span>
          </TabsTrigger>
          <TabsTrigger value="scoring">Scoring Breakdown</TabsTrigger>
          <TabsTrigger value="final">Final Output</TabsTrigger>
          <TabsTrigger value="rejected">
            Rejected
            {rejected.length > 0 && (
              <span className="ml-1 rounded bg-[var(--color-bear)]/20 px-1 text-[9px] text-[var(--color-bear)]">{rejected.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="api-health">API Health</TabsTrigger>
        </TabsList>

        {/* ── TAB 1: SCAN INPUTS ─────────────────────────────────────────────── */}
        <TabsContent value="inputs" className="mt-4 space-y-4">
          <Section title="Scan Info" action={<CopyBtn data={scanInputsJson} />}>
            <Table rows={[
              ["Scan date", scanDate],
              ["Scan time", scanTime],
              ["Data mode", dataMode],
              ["Tickers scanned", String(symbols.length)],
              ["Candidates input", String(MOCK_CANDIDATES.length)],
              ["Passed visible", String(visible.length)],
              ["Final tradeable", String(finalCandidates.length)],
              ["Chain enriched", String(Object.values(chainData?.enriched ?? {}).filter(Boolean).length)],
              ["Rate limited", chainData?.rateLimited ? "YES" : "No"],
            ]} />
          </Section>

          <Section title="Market Inputs">
            <Table rows={[
              ["SPY price", `$${(regimeData?.quotes?.["SPY"]?.price ?? MOCK_REGIME.spy.price).toFixed(2)}`],
              ["SPY change", `${(regimeData?.quotes?.["SPY"]?.changePct ?? MOCK_REGIME.spy.changePct).toFixed(2)}%`],
              ["QQQ price", `$${(regimeData?.quotes?.["QQQ"]?.price ?? MOCK_REGIME.qqq.price).toFixed(2)}`],
              ["QQQ change", `${(regimeData?.quotes?.["QQQ"]?.changePct ?? MOCK_REGIME.qqq.changePct).toFixed(2)}%`],
              ["SMH price", `$${(regimeData?.quotes?.["SMH"]?.price ?? MOCK_REGIME.smh.price).toFixed(2)}`],
              ["VIX", String(MOCK_REGIME.vix.level)],
              ["Market regime", MOCK_REGIME.bias],
              ["Scanner bias", MOCK_REGIME.scannerBias],
              ["Market data source", regimeData?.live ? "Live (regime-quotes)" : "Demo (MOCK_REGIME)"],
            ]} />
          </Section>

          <Section title="Scanner Settings">
            <Table rows={[
              ["Max contract cost", `$${scannerSettings?.maxCost ?? 1000}`],
              ["Max tickers/scan", String(scannerSettings?.maxTickersPerScan ?? 12)],
              ["Full scan interval", `${Math.round((scannerSettings?.fullScanIntervalMs ?? 600000) / 60000)} min`],
              ["DTE range (short-term)", "14–30d"],
              ["DTE range (LEAPS)", "180–730d"],
              ["Delta target", "0.30–0.50"],
              ["IV max", "80%"],
              ["Spread max", "15%"],
              ["Theta burn max", "8%/day"],
              ["Min volume", "50"],
              ["Min open interest", "100"],
              ["Include LEAPS", "true"],
              ["Include YOLO", "true"],
              ["Extended swing (31–45d)", "true"],
            ]} />
          </Section>

          <Section title="Ticker Universe">
            <div className="flex flex-wrap gap-1.5">
              {symbols.map(s => (
                <span key={s} className="rounded border border-border bg-muted/20 px-2 py-0.5 font-mono text-[11px]">{s}</span>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">{symbols.length} unique tickers from {MOCK_CANDIDATES.length} candidate entries</p>
          </Section>
        </TabsContent>

        {/* ── TAB 2: RAW API DATA ───────────────────────────────────────────── */}
        <TabsContent value="raw-api" className="mt-4 space-y-4">
          {chainData?.rateLimited && (
            <div className="rounded-lg border border-[var(--color-bear)]/30 bg-[var(--color-bear)]/5 px-4 py-3 text-sm font-medium text-[var(--color-bear)]">
              429 Rate limited — retry/backoff required. Showing cached or demo data meanwhile.
              {chainData.cooldownMs > 0 && <span className="ml-2 text-xs font-normal">Cooldown: {Math.ceil(chainData.cooldownMs / 1000)}s</span>}
            </div>
          )}

          <Section title="Option Chain Enrichment (Public.com API)" action={<CopyBtn data={chainData ?? {}} />}>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="border-b border-border bg-muted/20 text-[9px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Ticker</th>
                    <th className="px-3 py-2 text-left">Direction</th>
                    <th className="px-3 py-2 text-left">Key</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-right">Strike</th>
                    <th className="px-3 py-2 text-right">Ask</th>
                    <th className="px-3 py-2 text-right">Delta</th>
                    <th className="px-3 py-2 text-right">IV</th>
                    <th className="px-3 py-2 text-right">DTE</th>
                    <th className="px-3 py-2 text-left">Missing Fields</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {traces.map(({ c }) => {
                    const contract = c.contract;
                    const isChain = contract.source === "chain";
                    return (
                      <tr key={c.id} className="hover:bg-muted/10">
                        <td className="px-3 py-1.5 font-bold">{c.ticker}</td>
                        <td className={cn("px-3 py-1.5 font-bold text-[10px]", c.direction === "CALL" ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]")}>{c.direction}</td>
                        <td className="px-3 py-1.5 font-mono text-[9px] text-muted-foreground max-w-[12rem] truncate">{contract.optionTicker ?? "—"}</td>
                        <td className="px-3 py-1.5">
                          {isChain
                            ? <Badge kind="verified" label="200 OK" />
                            : <Badge kind="demo" label="DEMO" />}
                        </td>
                        <td className="px-3 py-1.5 text-[10px]">{contract.source}</td>
                        <td className="px-3 py-1.5 text-right font-mono">${contract.strike}</td>
                        <td className="px-3 py-1.5 text-right font-mono">${contract.ask.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{contract.delta.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{(contract.iv * 100).toFixed(0)}%</td>
                        <td className="px-3 py-1.5 text-right font-mono">{contract.dte}d</td>
                        <td className="px-3 py-1.5 text-[9px] text-[var(--color-bear)]/80 max-w-[14rem]">
                          {(contract.missingFields ?? []).length > 0
                            ? (contract.missingFields ?? []).join(", ")
                            : <span className="text-[var(--color-bull)]/70">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Stock Quote Cache (regime-quotes)">
            {regimeData ? (
              <Table rows={[
                ["SPY", `$${(regimeData.quotes?.["SPY"]?.price ?? MOCK_REGIME.spy.price).toFixed(2)} (${(regimeData.quotes?.["SPY"]?.changePct ?? MOCK_REGIME.spy.changePct).toFixed(2)}%)`],
                ["QQQ", `$${(regimeData.quotes?.["QQQ"]?.price ?? MOCK_REGIME.qqq.price).toFixed(2)} (${(regimeData.quotes?.["QQQ"]?.changePct ?? MOCK_REGIME.qqq.changePct).toFixed(2)}%)`],
                ["SMH", `$${(regimeData.quotes?.["SMH"]?.price ?? MOCK_REGIME.smh.price).toFixed(2)} (${(regimeData.quotes?.["SMH"]?.changePct ?? MOCK_REGIME.smh.changePct).toFixed(2)}%)`],
                ["Live", regimeData.live ? "Yes" : "No (demo/fallback)"],
              ]} />
            ) : (
              <p className="text-xs text-muted-foreground">No regime-quotes cache found. NavBar hasn't completed its first fetch yet.</p>
            )}
          </Section>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-400">
            <strong>Rule enforced:</strong> Stock endpoints cannot populate option contract fields. Strikes, expirations, bid/ask, and Greeks must come from the options chain. Any field sourced from stock data is marked <Badge kind="synthetic" label="SYNTHETIC" />.
          </div>
        </TabsContent>

        {/* ── TAB 3: NORMALIZED DATA ───────────────────────────────────────── */}
        <TabsContent value="normalized" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>Legend:</span>
            <Badge kind="verified" /><Badge kind="calculated" /><Badge kind="cached" /><Badge kind="missing" /><Badge kind="synthetic" /><Badge kind="demo" />
          </div>

          <Section title="Normalized Option Contracts" action={<CopyBtn data={traces.map(t => t.c.contract)} />}>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="border-b border-border bg-muted/20 text-[9px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    {["Ticker", "Dir", "Source", "Strike", "Exp", "DTE", "Bid", "Ask", "Mid", "Spread", "Delta", "Theta", "IV", "Volume", "OI", "BE+", "Broker Confirm", "Status"].map(h => (
                      <th key={h} className="px-2 py-2 text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {traces.map(({ c }) => {
                    const k = c.contract;
                    const src = contractBadge(k);
                    const mid = k.mid ?? (k.bid + k.ask) / 2;
                    return (
                      <tr key={c.id} className="hover:bg-muted/10">
                        <td className="px-2 py-1.5 font-bold">{c.ticker}</td>
                        <td className={cn("px-2 py-1.5 font-bold text-[10px]", c.direction === "CALL" ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]")}>{c.direction}</td>
                        <td className="px-2 py-1.5"><Badge kind={src} /></td>
                        <td className="px-2 py-1.5 font-mono">
                          {k.source !== "chain" ? <><Badge kind="synthetic" label="SYN" /> ${k.strike}</> : `$${k.strike}`}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[10px]">
                          {k.source !== "chain" ? <><Badge kind="synthetic" label="SYN" /> {k.expiration}</> : k.expiration}
                        </td>
                        <td className="px-2 py-1.5 font-mono">{k.dte}d</td>
                        <td className="px-2 py-1.5 font-mono">${k.bid.toFixed(2)}</td>
                        <td className="px-2 py-1.5 font-mono">${k.ask.toFixed(2)}</td>
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">${mid.toFixed(2)}</td>
                        <td className={cn("px-2 py-1.5 font-mono", k.spreadPct > 0.15 ? "text-[var(--color-bear)]" : k.spreadPct > 0.08 ? "text-amber-400" : "")}>{(k.spreadPct * 100).toFixed(1)}%</td>
                        <td className="px-2 py-1.5 font-mono">{k.delta.toFixed(2)}</td>
                        <td className="px-2 py-1.5 font-mono">{k.theta.toFixed(3)}</td>
                        <td className="px-2 py-1.5 font-mono">{(k.iv * 100).toFixed(0)}%</td>
                        <td className={cn("px-2 py-1.5 font-mono", k.volume < 50 ? "text-[var(--color-bear)]" : "")}>{k.volume.toLocaleString()}</td>
                        <td className={cn("px-2 py-1.5 font-mono", k.openInterest < 100 ? "text-[var(--color-bear)]" : "")}>{k.openInterest.toLocaleString()}</td>
                        <td className={cn("px-2 py-1.5 font-mono", k.breakevenMovePct > 0.15 ? "text-[var(--color-bear)]" : k.breakevenMovePct > 0.08 ? "text-amber-400" : "")}>{(k.breakevenMovePct * 100).toFixed(1)}%</td>
                        <td className="px-2 py-1.5">{k.brokerConfirmRequired ? <Badge kind="unverified" label="REQUIRED" /> : <Badge kind="verified" label="OK" />}</td>
                        <td className="px-2 py-1.5"><Badge kind={src} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Missing / Synthetic Fields Alert">
            <div className="space-y-1.5">
              {traces.filter(t => (t.c.contract.missingFields ?? []).length > 0 || t.c.contract.source !== "chain").map(({ c }) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded border border-[var(--color-bear)]/20 bg-[var(--color-bear)]/5 px-3 py-2 text-xs">
                  <span className="font-bold">{c.ticker}</span>
                  <span className={cn("text-[10px]", c.direction === "CALL" ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]")}>{c.direction}</span>
                  {c.contract.source !== "chain" && <Badge kind="synthetic" label={`SYNTHETIC STRIKE ($${c.contract.strike})`} />}
                  {c.contract.source !== "chain" && <Badge kind="synthetic" label={`SYNTHETIC EXPIRATION (${c.contract.expiration})`} />}
                  {(c.contract.missingFields ?? []).map(f => <Badge key={f} kind="missing" label={f.toUpperCase()} />)}
                </div>
              ))}
              {traces.every(t => (t.c.contract.missingFields ?? []).length === 0 && t.c.contract.source === "chain") && (
                <p className="text-xs text-[var(--color-bull)]">All contracts fully verified — no synthetic or missing fields.</p>
              )}
            </div>
          </Section>
        </TabsContent>

        {/* ── TAB 4: CONTRACT FILTER RESULTS ───────────────────────────────── */}
        <TabsContent value="filters" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Total scanned", value: traces.length, tone: "" },
              { label: "Passed visible", value: visible.length, tone: "text-[var(--color-bull)]" },
              { label: "Tradeable", value: finalCandidates.length, tone: "text-[var(--color-bull)]" },
              { label: "Rejected", value: rejected.length, tone: "text-[var(--color-bear)]" },
              { label: "Demo / Unverified", value: traces.filter(t => t.c.contract.source !== "chain").length, tone: "text-amber-400" },
              { label: "Buy Now eligible", value: traces.filter(t => t.gate.buyNowEligible).length, tone: "text-[var(--color-bull)]" },
            ].map(s => (
              <div key={s.label} className="rounded-lg border border-border bg-card px-3 py-2.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
                <div className={cn("mt-1 text-xl font-bold tabular-nums", s.tone)}>{s.value}</div>
              </div>
            ))}
          </div>

          <Section title="Contract Filter — All 15 Validation Rules Per Candidate">
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead className="border-b border-border bg-muted/20 text-[9px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Ticker</th>
                    <th className="px-2 py-2 text-left">Dir</th>
                    <th className="px-2 py-2 text-left">Label</th>
                    {Array.from({ length: 15 }, (_, i) => (
                      <th key={i} className="px-1 py-2 text-center">#{i + 1}</th>
                    ))}
                    <th className="px-2 py-2 text-left">Blockers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {traces.map(({ c, rules, gate }) => (
                    <tr key={c.id} className="hover:bg-muted/10">
                      <td className="px-2 py-1.5 font-bold whitespace-nowrap">{c.ticker}</td>
                      <td className={cn("px-2 py-1.5 font-bold", c.direction === "CALL" ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]")}>{c.direction}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{c.label}</td>
                      {rules.map(r => (
                        <td key={r.id} className="px-1 py-1.5 text-center" title={`${r.name}: ${r.detail}`}>
                          <span className={r.pass ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]"}>
                            {r.pass ? "✓" : "✗"}
                          </span>
                        </td>
                      ))}
                      <td className="px-2 py-1.5 max-w-[16rem] text-[var(--color-bear)]/80">
                        {gate.buyNowBlockers.slice(0, 2).join(" · ")}
                        {gate.buyNowBlockers.length > 2 && ` +${gate.buyNowBlockers.length - 2}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[9px] text-muted-foreground sm:grid-cols-5">
              {validateContractRules(traces[0]?.c ?? MOCK_CANDIDATES[0]).map(r => (
                <div key={r.id}>#{r.id} {r.name}</div>
              ))}
            </div>
          </Section>
        </TabsContent>

        {/* ── TAB 5: SCORING BREAKDOWN ─────────────────────────────────────── */}
        <TabsContent value="scoring" className="mt-4 space-y-3">
          {traces.map(({ c, gate }) => (
            <ScoringCard key={c.id} c={c} gate={gate} />
          ))}
        </TabsContent>

        {/* ── TAB 6: FINAL OUTPUT ──────────────────────────────────────────── */}
        <TabsContent value="final" className="mt-4 space-y-4">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-400">
            <strong>Hard rule:</strong> If verification status is not <Badge kind="verified" label="API VERIFIED" />, max label is Watchlist / Broker Confirmation Required. Buy Now requires all 15 rules to pass.
          </div>

          {finalCandidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
              No Buy Now / Watchlist candidates in current data. All contracts need broker confirmation (synthetic strikes).
            </div>
          ) : (
            <div className="space-y-3">
              {finalCandidates.map(({ c, gate, rules }) => (
                <FinalOutputCard key={c.id} c={c} gate={gate} rules={rules} />
              ))}
            </div>
          )}

          <Section title="Avoid / Do Not Chase">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="border-b border-border bg-muted/20 text-[9px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Ticker</th>
                    <th className="px-3 py-2 text-left">Dir</th>
                    <th className="px-3 py-2 text-left">Label</th>
                    <th className="px-3 py-2 text-left">Primary Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {visible.filter(t => ["Avoid Ticker", "Avoid Contract", "Avoid"].includes(t.c.label)).map(({ c, gate }) => (
                    <tr key={c.id} className="hover:bg-muted/10">
                      <td className="px-3 py-1.5 font-bold">{c.ticker}</td>
                      <td className={cn("px-3 py-1.5 font-bold text-[10px]", c.direction === "CALL" ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]")}>{c.direction}</td>
                      <td className="px-3 py-1.5 text-[var(--color-bear)]">{c.label}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{gate.reasons[0] ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </TabsContent>

        {/* ── TAB 7: REJECTED ──────────────────────────────────────────────── */}
        <TabsContent value="rejected" className="mt-4 space-y-4">
          <div className="rounded-lg border border-[var(--color-bear)]/20 bg-[var(--color-bear)]/5 px-4 py-3 text-sm font-medium text-[var(--color-bear)]">
            Rejected contracts are not trade candidates. Do not act on these.
          </div>

          <Section title={`Rejected / Hidden Contracts (${rejected.length})`} action={<CopyBtn data={rejected.map(t => ({ ticker: t.c.ticker, reasons: t.gate.reasons }))} />}>
            {rejected.length === 0 ? (
              <p className="text-xs text-muted-foreground">No rejected contracts in current data.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="border-b border-border bg-muted/20 text-[9px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Ticker</th>
                      <th className="px-3 py-2 text-left">Dir</th>
                      <th className="px-3 py-2 text-left">Strike</th>
                      <th className="px-3 py-2 text-left">Expiration</th>
                      <th className="px-3 py-2 text-left">DTE</th>
                      <th className="px-3 py-2 text-left">Strike from chain?</th>
                      <th className="px-3 py-2 text-left">Exp from chain?</th>
                      <th className="px-3 py-2 text-left">Bid/ask verified?</th>
                      <th className="px-3 py-2 text-left">Reason rejected</th>
                      <th className="px-3 py-2 text-left">Scanner action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {rejected.map(({ c, gate }) => {
                      const k = c.contract;
                      const fromChain = k.source === "chain";
                      const bidAskOk = !(k.missingFields ?? []).some(f => /quote|bid|ask/.test(f));
                      return (
                        <tr key={c.id} className="hover:bg-muted/10">
                          <td className="px-3 py-1.5 font-bold">{c.ticker}</td>
                          <td className={cn("px-3 py-1.5 font-bold text-[10px]", c.direction === "CALL" ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]")}>{c.direction}</td>
                          <td className="px-3 py-1.5 font-mono">${k.strike}</td>
                          <td className="px-3 py-1.5 font-mono text-[10px]">{k.expiration}</td>
                          <td className="px-3 py-1.5 font-mono">{k.dte}d</td>
                          <td className="px-3 py-1.5">{fromChain ? <Badge kind="verified" label="Yes" /> : <Badge kind="synthetic" label="No — Synthetic" />}</td>
                          <td className="px-3 py-1.5">{fromChain ? <Badge kind="verified" label="Yes" /> : <Badge kind="synthetic" label="No — Synthetic" />}</td>
                          <td className="px-3 py-1.5">{bidAskOk ? <Badge kind="verified" label="Yes" /> : <Badge kind="missing" label="No" />}</td>
                          <td className="px-3 py-1.5 text-[var(--color-bear)]/80 max-w-[16rem]">{gate.reasons.slice(0, 2).join(" · ")}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">Hidden from UI</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </TabsContent>

        {/* ── TAB 8: API HEALTH ────────────────────────────────────────────── */}
        <TabsContent value="api-health" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Total calls", value: apiStats.total },
              { label: "Success", value: apiStats.success, tone: "text-[var(--color-bull)]" },
              { label: "Failed", value: apiStats.failed, tone: apiStats.failed > 0 ? "text-[var(--color-bear)]" : "" },
              { label: "429 / Rate limited", value: apiStats.rate429, tone: apiStats.rate429 > 0 ? "text-[var(--color-bear)]" : "" },
              { label: "Cached", value: apiStats.cached, tone: "text-amber-400" },
              { label: "Avg response ms", value: apiStats.avgMs },
            ].map(s => (
              <div key={s.label} className="rounded-lg border border-border bg-card px-3 py-2.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
                <div className={cn("mt-1 text-xl font-bold tabular-nums", s.tone ?? "")}>{s.value}</div>
              </div>
            ))}
          </div>

          {chainData?.rateLimited && (
            <div className="rounded-lg border border-[var(--color-bear)]/30 bg-[var(--color-bear)]/5 px-4 py-3 text-xs text-[var(--color-bear)]">
              Rate limit hit. Retry in {Math.ceil((chainData.cooldownMs ?? 0) / 1000)}s. Scanner is showing demo / cached data.
            </div>
          )}

          <Section title="API Event Log" action={<CopyBtn data={events} />}>
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">No API events logged. Run a scan to populate.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead className="border-b border-border bg-muted/20 text-[9px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      {["Time", "Endpoint", "Ticker", "Status", "Ms", "Cached", "Retries", "Error"].map(h => (
                        <th key={h} className="px-2 py-2 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {events.slice(-100).reverse().map((e, i) => (
                      <tr key={i} className="hover:bg-muted/10">
                        <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">{e.ts ? new Date(e.ts).toLocaleTimeString() : "—"}</td>
                        <td className="px-2 py-1 max-w-[14rem] truncate">{e.endpoint ?? "—"}</td>
                        <td className="px-2 py-1 font-bold">{e.ticker ?? "—"}</td>
                        <td className={cn("px-2 py-1 font-bold", e.status >= 400 ? "text-[var(--color-bear)]" : e.status >= 200 ? "text-[var(--color-bull)]" : "text-muted-foreground")}>
                          {e.status}
                        </td>
                        <td className="px-2 py-1">{e.durationMs ?? "—"}</td>
                        <td className="px-2 py-1">{e.cached ? <Badge kind="cached" label="HIT" /> : "—"}</td>
                        <td className="px-2 py-1">{e.retryCount ?? 0}</td>
                        <td className="px-2 py-1 max-w-[16rem] truncate text-[var(--color-bear)]/80">{e.error ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Scoring Card ──────────────────────────────────────────────────────────────
function ScoringCard({ c, gate }: { c: TradeCandidate; gate: DisciplineGateResult }) {
  const [open, setOpen] = useState(false);
  const score = gate.finalScore;
  const scoreCls = score >= 85 ? "text-[var(--color-bull)]" : score >= 70 ? "text-[var(--color-watch)]" : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <span className="font-bold">{c.ticker}</span>
        <span className={cn("text-[10px] font-bold", c.direction === "CALL" ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]")}>{c.direction}</span>
        <span className="text-xs text-muted-foreground">{c.setupType}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className={cn("font-mono text-lg font-bold", scoreCls)}>{score}</span>
          <span className="text-xs text-muted-foreground">{c.label}</span>
          <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <ScoreBlock label="Setup" value={gate.setupScore} max={30} />
            <ScoreBlock label="Contract" value={gate.contractScore} max={35} />
            <ScoreBlock label="Trigger" value={gate.triggerScore} max={10} />
            <ScoreBlock label="Risk/Reward" value={gate.riskRewardScore} max={10} />
            <ScoreBlock label="Data Quality" value={gate.dataQualityScore} max={10} />
          </div>
          <div className="mt-3 space-y-1">
            {gate.reasons.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="mt-px text-muted-foreground/50">·</span>
                <span className="text-muted-foreground">{r}</span>
              </div>
            ))}
          </div>
          {gate.buyNowBlockers.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-bear)]/70">Buy Now blockers</div>
              {gate.buyNowBlockers.map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-[var(--color-bear)]/80">
                  <span className="mt-px">✗</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          )}
          {(c.scorePenalties ?? []).length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-500/70">Score penalties</div>
              {c.scorePenalties!.map((p, i) => (
                <div key={i} className="text-xs text-amber-400">{p.reason} ({p.delta})</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreBlock({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(value / max, 1);
  const cls = pct >= 0.8 ? "bg-[var(--color-bull)]" : pct >= 0.5 ? "bg-[var(--color-watch)]" : "bg-[var(--color-bear)]/60";
  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold">{value}<span className="text-muted-foreground">/{max}</span></span>
      </div>
      <div className="mt-1 h-1 w-full rounded-full bg-border">
        <div className={cn("h-full rounded-full transition-all", cls)} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

// ── Final Output Card ─────────────────────────────────────────────────────────
function FinalOutputCard({ c, gate, rules }: { c: TradeCandidate; gate: DisciplineGateResult; rules: RuleResult[] }) {
  const k = c.contract;
  const isVerified = k.source === "chain";
  const failedRules = rules.filter(r => !r.pass);

  const verificationBadge: BadgeKind = isVerified ? "verified" : k.brokerConfirmRequired ? "unverified" : "demo";
  const verificationLabel = isVerified ? "API VERIFIED" : k.brokerConfirmRequired ? "BROKER CONFIRM REQUIRED" : "DEMO — NOT VERIFIED";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{c.ticker}</span>
        <span className={cn("text-[10px] font-bold", c.direction === "CALL" ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]")}>{c.direction}</span>
        <span className="text-xs text-muted-foreground">{c.setupType}</span>
        <Badge kind={verificationBadge} label={verificationLabel} />
        {failedRules.length > 0 && (
          <span className="text-[10px] text-[var(--color-bear)]/80">{failedRules.length} rule{failedRules.length !== 1 ? "s" : ""} failed</span>
        )}
        <span className="ml-auto font-mono font-bold">{c.label}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[10px] sm:grid-cols-4">
        {[
          ["Strike", `$${k.strike}${!isVerified ? " ⚠ SYNTHETIC" : ""}`],
          ["Exp", k.expiration],
          ["DTE", `${k.dte}d`],
          ["Ask", `$${k.ask.toFixed(2)}`],
          ["Delta", k.delta.toFixed(2)],
          ["IV", `${(k.iv * 100).toFixed(0)}%`],
          ["Score", String(gate.finalScore)],
          ["T1 / T2", `$${c.target1.toFixed(0)} / $${c.target2.toFixed(0)}`],
        ].map(([label, val]) => (
          <div key={label} className="flex justify-between">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono font-semibold">{val}</span>
          </div>
        ))}
      </div>
      {failedRules.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {failedRules.map(r => <Badge key={r.id} kind="invalid" label={`#${r.id} ${r.name}`} />)}
        </div>
      )}
    </div>
  );
}

// ── Simple table helper ───────────────────────────────────────────────────────
function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div className="space-y-px">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 py-0.5 text-xs">
          <span className="shrink-0 text-muted-foreground">{k}</span>
          <span className="font-mono text-right text-foreground/90">{v}</span>
        </div>
      ))}
    </div>
  );
}
