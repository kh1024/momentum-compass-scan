import type { TradeCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";

const labelClass = (label: TradeCandidate["label"]) =>
  label === "Buy Now" ? "text-[var(--color-bull)]"
  : label === "Watchlist" ? "text-[var(--color-watch)]"
  : label === "Aggressive" ? "text-amber-500"
  : label === "Lotto" ? "text-purple-400"
  : label === "Find Better Strike" ? "text-amber-500"
  : "text-[var(--color-bear)]";

export function TradeTable({
  rows,
  onOpen,
}: {
  rows: TradeCandidate[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-xs">
        <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            {[
              "Ticker","Dir","Label","Score","Setup","Price","Exp","Strike","Ask","Cost","Δ","IV","DTE","Vol/OI","Trigger","Reason",""
            ].map((h) => <th key={h} className="px-2 py-2 text-left">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const c = t.contract;
            const isLive = c.source === "chain";
            const dash = "—";
            const triggerActive = t.triggerStatus === "active";
            return (
              <tr
                key={t.id}
                onClick={() => onOpen(t.id)}
                className="cursor-pointer border-t border-border hover:bg-muted/30"
              >
                <td className="px-2 py-1.5 font-semibold">{t.ticker}</td>
                <td className="px-2 py-1.5">{t.direction}</td>
                <td className={cn("px-2 py-1.5 font-semibold", labelClass(t.label))}>{t.label}</td>
                <td className="px-2 py-1.5 mono text-right">{t.finalScore ?? t.score}</td>
                <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[10rem]">{t.setupType}</td>
                <td className="px-2 py-1.5 mono">${t.price.toFixed(2)}</td>
                <td className="px-2 py-1.5 mono">{isLive ? c.expiration : dash}</td>
                <td className="px-2 py-1.5 mono">{isLive ? `$${c.strike}` : dash}</td>
                <td className="px-2 py-1.5 mono">{isLive ? `$${c.ask.toFixed(2)}` : dash}</td>
                <td className="px-2 py-1.5 mono">{isLive ? `$${(c.ask * 100).toFixed(0)}` : dash}</td>
                <td className="px-2 py-1.5 mono">{isLive ? c.delta.toFixed(2) : dash}</td>
                <td className="px-2 py-1.5 mono">{isLive ? `${(c.iv * 100).toFixed(0)}%` : dash}</td>
                <td className="px-2 py-1.5 mono">{isLive ? c.dte : dash}</td>
                <td className="px-2 py-1.5 mono">{isLive ? `${c.volume.toLocaleString()}/${c.openInterest.toLocaleString()}` : dash}</td>
                <td className={cn("px-2 py-1.5 font-medium", triggerActive ? "text-[var(--color-bull)]" : "text-muted-foreground")}>
                  {triggerActive ? "Active" : t.triggerStatus ?? "—"}
                </td>
                <td className="px-2 py-1.5 truncate max-w-[16rem] text-muted-foreground">
                  {(t.buyNowBlockers && t.buyNowBlockers[0]) || t.validationReason || ""}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}
                    className="rounded-md border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
                  >
                    Details
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={17} className="px-3 py-8 text-center text-muted-foreground">No candidates match your filters.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
