import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { MOCK_CANDIDATES } from "@/lib/mockData";
import { ScoreRing } from "@/components/ScoreRing";
import { LabelChip, DirectionChip, SentimentBadge, DataStateBadge, VerificationBadge } from "@/components/Badges";
import { NovaExplainer } from "@/components/NovaExplainer";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useLiveContract } from "@/hooks/useLiveContract";
import { applyLiveQuote } from "@/lib/applyLiveQuote";

const search = z.object({ id: z.string().optional() });

export const Route = createFileRoute("/trade/$ticker")({
  validateSearch: zodValidator(search),
  loaderDeps: ({ search: { id } }) => ({ id }),
  loader: ({ params, deps }) => {
    const t = MOCK_CANDIDATES.find(c => (deps.id ? c.id === deps.id : c.ticker === params.ticker));
    if (!t) throw notFound();
    return t;
  },
  head: ({ params }) => ({ meta: [{ title: `${params.ticker} — Trade Detail` }] }),
  notFoundComponent: () => (
    <div className="py-16 text-center">
      <p className="text-sm text-muted-foreground">Trade not found.</p>
      <Link to="/scanner" className="mt-3 inline-block text-sm underline">Back to scanner</Link>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="py-16 text-center">
      <p className="text-sm text-muted-foreground">Couldn't load this trade: {error.message}</p>
    </div>
  ),
  component: TradeDetail,
});

function TradeDetail() {
  const base = Route.useLoaderData();
  const { get: getLive } = useLiveQuotes([base.ticker]);
  const scaled = applyLiveQuote(base, getLive(base.ticker));
  const { contract: liveContract } = useLiveContract(base.ticker, base.direction, {
    isLeaps: base.setupType === "LEAPS",
    isYolo: base.setupType === "Reddit YOLO",
  });
  const t = liveContract ? { ...scaled, contract: liveContract, isDemo: false } : scaled;
  const c = t.contract;
  const L = t.levels;

  return (
    <div className="space-y-6">
      <Link to="/scanner" className="text-xs text-muted-foreground hover:text-foreground">← Back to scanner</Link>

      <header className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <ScoreRing score={t.score} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{t.ticker}</h1>
              <DirectionChip direction={t.direction} />
              <LabelChip label={t.label} />
              <span className="mono text-lg">${t.price.toFixed(2)}</span>
              <span className="text-xs text-muted-foreground">{t.cap} cap · {t.setupType}</span>
              <DataStateBadge state={t.liveState ?? (t.isDemo ? "demo" : "live")} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t.trend}</p>
            <p className="mt-1 text-sm">
              <span className="text-muted-foreground">Why {t.direction === "CALL" ? "bullish" : "bearish"}:</span>{" "}
              <span className="text-foreground">{t.sectorConfirmation}</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <SentimentBadge s={t.redditSentiment} />
              <VerificationBadge v={t.contract.verification} />
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Support & Resistance Map">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <Row k="R3" v={L.r3} className="text-[var(--color-bear)]" />
            <Row k="R2" v={L.r2} className="text-[var(--color-bear)]" />
            <Row k="R1" v={L.r1} className="text-[var(--color-bear)]" />
            <Row k="Pivot" v={L.pivot} />
            <Row k="Base High" v={L.baseHigh} />
            <Row k="Base Mid" v={L.baseMid} />
            <Row k="Base Low" v={L.baseLow} />
            <Row k="20 DMA" v={L.dma20} />
            <Row k="50 DMA" v={L.dma50} />
            <Row k="200 DMA" v={L.dma200} />
            <Row k="VWAP" v={L.vwap ?? 0} />
            <Row k="S1" v={L.s1} className="text-[var(--color-bull)]" />
            <Row k="S2" v={L.s2} className="text-[var(--color-bull)]" />
            <Row k="S3" v={L.s3} className="text-[var(--color-bull)]" />
          </div>
        </Panel>

        <Panel title="Suggested Contract">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <Row k="Expiration" raw={c.expiration} />
            <Row k="Strike" v={c.strike} prefix="$" />
            <Row k="Ask" v={c.ask} prefix="$" />
            <Row k="Bid" v={c.bid} prefix="$" />
            <Row k="Contract Cost" v={c.cost} prefix="$" decimals={0} />
            <Row k="DTE" raw={`${c.dte}d`} />
            <Row k="IV" raw={`${(c.iv * 100).toFixed(0)}%`} />
            <Row k="Delta" v={c.delta} />
            <Row k="Theta" v={c.theta} />
            <Row k="Theta Burn" raw={`${(c.thetaBurnPct * 100).toFixed(2)}%/d`} />
            <Row k="Gamma" v={c.gamma} />
            <Row k="Vega" v={c.vega} />
            <Row k="Volume" raw={c.volume.toLocaleString()} />
            <Row k="OI" raw={c.openInterest.toLocaleString()} />
            <Row k="Spread" raw={`${(c.spreadPct * 100).toFixed(1)}%`} />
            <Row k="Breakeven" v={c.breakeven} prefix="$" />
            <Row k="BE move" raw={`${(c.breakevenMovePct * 100).toFixed(1)}%`} />
          </div>
        </Panel>

        <Panel title="Entry & Exit Plan">
          <Bullet k="Entry Trigger" v={t.entryTrigger} />
          <Bullet k="Invalidation" v={t.invalidation} />
          <Bullet k="Target 1" v={`$${t.target1.toFixed(2)}`} />
          <Bullet k="Target 2" v={`$${t.target2.toFixed(2)}`} />
          <Bullet k="Entry Strategy" v={t.entryStrategy} />
          <Bullet k="Exit Strategy" v={t.exitStrategy} />
          <Bullet k="Profit Plan" v={t.profitPlan} />
          <Bullet k="Sizing" v={t.sizing} />
        </Panel>

        <Panel title="Risk Warnings">
          <ul className="space-y-1.5 text-sm">
            {t.keyRisks.map((r: string) => <li key={r} className="text-[var(--color-bear)]">• {r}</li>)}
          </ul>
          {t.thesis && (
            <>
              <h4 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">LEAPS Thesis</h4>
              <p className="mt-1 text-sm">{t.thesis}</p>
              {t.monthlyReview && <p className="mt-2 text-xs text-muted-foreground">{t.monthlyReview}</p>}
            </>
          )}
          {t.whyExplode && (
            <>
              <h4 className="mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--color-bull)]">Why it could explode</h4>
              <p className="mt-1 text-sm">{t.whyExplode}</p>
            </>
          )}
          {t.whyZero && (
            <>
              <h4 className="mt-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-bear)]">Why it could go to zero</h4>
              <p className="mt-1 text-sm">{t.whyZero}</p>
            </>
          )}
        </Panel>
      </div>

      <NovaExplainer t={t} />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold tracking-tight">{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v, raw, className, prefix = "", decimals = 2 }: { k: string; v?: number; raw?: string; className?: string; prefix?: string; decimals?: number }) {
  return (
    <>
      <div className="text-muted-foreground">{k}</div>
      <div className={"mono text-right font-medium " + (className ?? "")}>
        {raw ?? `${prefix}${(v ?? 0).toFixed(decimals)}`}
      </div>
    </>
  );
}

function Bullet({ k, v }: { k: string; v: string }) {
  return (
    <div className="mb-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="text-sm">{v}</div>
    </div>
  );
}
