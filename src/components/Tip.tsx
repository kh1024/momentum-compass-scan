import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function Tip({
  children,
  content,
  side = "top",
  wide = false,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  wide?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          className={cn(
            "z-[200] max-h-[320px] overflow-y-auto rounded-md border border-[#3f3f46] bg-[#111113] px-3 py-2 text-left text-xs text-[#fafafa] shadow-xl",
            wide ? "max-w-[320px]" : "max-w-[240px]",
          )}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Pre-built tooltip content for every common field ─────────────────────────

export const TIPS = {
  // Labels
  label: {
    "Buy Now": (
      <div>
        <div className="mb-1 font-bold text-[#10b981]">Buy Now</div>
        All 15 discipline-gate checks passed. Score ≥85, trigger active, contract source verified, spread ≤15%, breakeven ≤8%. Highest conviction setup.
      </div>
    ),
    "Watchlist": (
      <div>
        <div className="mb-1 font-bold text-[#f59e0b]">Watchlist</div>
        Setup is valid but missing one qualifier — usually entry timing has not confirmed yet or score is 70–84. Keep it on watch before entering.
      </div>
    ),
    "Waiting on Trigger": (
      <div>
        <div className="mb-1 font-bold text-[#f59e0b]">Watchlist</div>
        Setup is close, but price has not confirmed the entry yet. Monitor the key level and avoid chasing early.
      </div>
    ),
    "Aggressive": (
      <div>
        <div className="mb-1 font-bold text-amber-500">Aggressive</div>
        Entry is outside ideal parameters — wider spread, higher breakeven move, or trigger uncertain. Size smaller than normal. Higher risk of loss.
      </div>
    ),
    "Lotto": (
      <div>
        <div className="mb-1 font-bold text-purple-400">Lotto</div>
        DTE 7–13 days. IV typically elevated. Binary outcome — either quick move or total loss. Max position: 0.25–0.5% of account. Never chase.
      </div>
    ),
    "Near Miss": (
      <div>
        <div className="mb-1 font-bold text-fuchsia-400">Near Miss</div>
        Almost qualifies. One or two metrics are just outside the threshold. Re-check at next scan — conditions may improve. Do not force the entry.
      </div>
    ),
    "Find Better Strike": (
      <div>
        <div className="mb-1 font-bold text-amber-400">Find Better Strike</div>
        The selected strike has a quality issue (spread, breakeven, or delta). Try a closer-to-money strike or different expiration. Check your broker.
      </div>
    ),
    "Avoid Contract": (
      <div>
        <div className="mb-1 font-bold text-orange-500">Avoid Contract</div>
        Contract quality fails — spread too wide (&gt;15%), OI/volume too low, or data is synthetic and unverified. The ticker may still be tradeable with a different strike.
      </div>
    ),
    "Avoid Ticker": (
      <div>
        <div className="mb-1 font-bold text-[#ef4444]">Avoid Ticker</div>
        The underlying stock fails the chart setup — broken structure, extended beyond targets, or bearish trend. Skip the ticker entirely regardless of option contract quality.
      </div>
    ),
  },

  // Contract fields
  dte: (
    <div>
      <div className="mb-1 font-bold">DTE — Days To Expiration</div>
      <div className="space-y-0.5 text-[#a1a1aa]">
        <div><span className="text-[#ef4444]">0–6d</span> — Excluded (too much theta risk)</div>
        <div><span className="text-purple-400">7–13d</span> — Lotto / Aggressive only</div>
        <div><span className="text-[#10b981]">14–30d</span> — Ideal short-term swing</div>
        <div><span className="text-amber-400">31–45d</span> — Extended swing (enabled)</div>
        <div><span className="text-[#71717a]">46–179d</span> — Excluded</div>
        <div><span className="text-sky-400">180d+</span> — LEAPS only</div>
      </div>
    </div>
  ),
  delta: (
    <div>
      <div className="mb-1 font-bold">Delta (Δ)</div>
      <div className="text-[#a1a1aa]">
        Probability the option expires in-the-money. Also measures how much the option moves per $1 stock move.
        <div className="mt-1 space-y-0.5">
          <div><span className="text-[#10b981]">0.30–0.50</span> — Ideal swing range</div>
          <div><span className="text-sky-400">0.60–0.80</span> — LEAPS target</div>
          <div><span className="text-[#ef4444]">&lt;0.20</span> — Too far OTM, likely Lotto</div>
          <div><span className="text-[#ef4444]">&gt;0.80</span> — Deep ITM, high cost</div>
        </div>
      </div>
    </div>
  ),
  iv: (
    <div>
      <div className="mb-1 font-bold">IV — Implied Volatility</div>
      <div className="text-[#a1a1aa]">
        The market's expectation of future price movement. Higher IV = more expensive options and faster premium decay.
        <div className="mt-1 space-y-0.5">
          <div><span className="text-[#10b981]">&lt;40%</span> — Low IV, cheaper options</div>
          <div><span className="text-amber-400">40–65%</span> — Moderate, normal for growth</div>
          <div><span className="text-[#ef4444]">&gt;80%</span> — High IV, avoid buying premium</div>
        </div>
      </div>
    </div>
  ),
  breakeven: (
    <div>
      <div className="mb-1 font-bold">BE+ — Breakeven Move</div>
      <div className="text-[#a1a1aa]">
        The stock must move this % beyond your strike for the option to profit at expiration.
        <div className="mt-1 space-y-0.5">
          <div><span className="text-[#10b981]">≤5%</span> — Excellent</div>
          <div><span className="text-[#10b981]">≤8%</span> — Buy Now eligible</div>
          <div><span className="text-amber-400">8–15%</span> — Caution, find better strike</div>
          <div><span className="text-[#ef4444]">&gt;15%</span> — Avoid</div>
        </div>
      </div>
    </div>
  ),
  spread: (
    <div>
      <div className="mb-1 font-bold">Spread %</div>
      <div className="text-[#a1a1aa]">
        Bid-ask spread as a % of the ask price. Wide spreads mean higher slippage when entering and exiting.
        <div className="mt-1 space-y-0.5">
          <div><span className="text-[#10b981]">≤10%</span> — Clean, liquid</div>
          <div><span className="text-amber-400">10–15%</span> — Caution</div>
          <div><span className="text-[#ef4444]">&gt;15%</span> — Find better strike</div>
          <div><span className="text-[#ef4444]">&gt;20%</span> — Avoid</div>
        </div>
      </div>
    </div>
  ),
  volume: (
    <div>
      <div className="mb-1 font-bold">Vol — Option Volume</div>
      <div className="text-[#a1a1aa]">
        Contracts traded today. Confirms liquidity and interest in this specific strike/expiration.
        <div className="mt-1 space-y-0.5">
          <div><span className="text-[#10b981]">≥500</span> — High liquidity</div>
          <div><span className="text-[#10b981]">≥250</span> — Good</div>
          <div><span className="text-amber-400">100–249</span> — Acceptable</div>
          <div><span className="text-[#ef4444]">50–99</span> — Find better strike</div>
          <div><span className="text-[#ef4444]">&lt;50</span> — Avoid</div>
        </div>
      </div>
    </div>
  ),
  oi: (
    <div>
      <div className="mb-1 font-bold">OI — Open Interest</div>
      <div className="text-[#a1a1aa]">
        Total outstanding contracts at this strike. High OI = established liquidity, tighter spreads, easier to exit.
        <div className="mt-1 space-y-0.5">
          <div><span className="text-[#10b981]">≥2,000</span> — Excellent</div>
          <div><span className="text-[#10b981]">≥1,000</span> — Good</div>
          <div><span className="text-amber-400">300–999</span> — Acceptable</div>
          <div><span className="text-[#ef4444]">&lt;100</span> — Avoid</div>
        </div>
      </div>
    </div>
  ),
  cost: (
    <div>
      <div className="mb-1 font-bold">Cost — Total Premium</div>
      <div className="text-[#a1a1aa]">
        Ask price × 100 shares. This is what you pay to open the position. Discipline max: $1,000 per contract.
        <br /><br />
        Always verify the ask in your broker before placing the order — live quotes may differ from scan data.
      </div>
    </div>
  ),
  score: (
    <div>
      <div className="mb-1 font-bold">Composite Score</div>
      <div className="text-[#a1a1aa]">
        Weighted sum of 5 sub-scores:
        <div className="mt-1 space-y-0.5">
          <div>Setup quality <span className="text-[#71717a]">/30</span></div>
          <div>Contract quality <span className="text-[#71717a]">/35</span></div>
          <div>Entry timing <span className="text-[#71717a]">/10</span></div>
          <div>Risk / reward <span className="text-[#71717a]">/10</span></div>
          <div>Data quality <span className="text-[#71717a]">/10</span></div>
        </div>
        <div className="mt-1.5 space-y-0.5">
          <div><span className="text-[#10b981]">≥85</span> — Buy Now eligible</div>
          <div><span className="text-[#f59e0b]">70–84</span> — Watchlist</div>
          <div><span className="text-[#71717a]">&lt;70</span> — Aggressive / below</div>
        </div>
      </div>
    </div>
  ),
  trigger: {
    active: (
      <div>
        <div className="mb-1 font-bold text-[#10b981]">Entry Confirmed</div>
        Price has confirmed the entry level. The setup is live now. Confirm in your broker before acting.
      </div>
    ),
    pending: (
      <div>
        <div className="mb-1 font-bold text-[#71717a]">Entry Pending</div>
        Price has not yet confirmed the entry level. Do not enter early — wait for confirmation before acting.
      </div>
    ),
    waitingRetest: (
      <div>
        <div className="mb-1 font-bold text-sky-400">Waiting — Retest</div>
        Price broke out and is now pulling back to retest the breakout level. This is a second-chance entry if the level holds.
      </div>
    ),
    stale: (
      <div>
        <div className="mb-1 font-bold text-amber-500">Stale Setup</div>
        The entry was confirmed earlier, but price has moved significantly since. Re-evaluate the setup from scratch before entering.
      </div>
    ),
  },
  ask: (
    <div>
      <div className="mb-1 font-bold">Ask Price</div>
      <div className="text-[#a1a1aa]">
        The price you pay to buy the option. This is per-share, multiply by 100 for total cost.
        <br /><br />
        Always use a limit order at or slightly above the mid-price to avoid paying full ask.
      </div>
    </div>
  ),
  strike: (
    <div>
      <div className="mb-1 font-bold">Strike Price</div>
      <div className="text-[#a1a1aa]">
        The price at which you have the right to buy (CALL) or sell (PUT) the underlying stock.
        <br /><br />
        <span className="text-amber-400">⚠ If marked SYNTHETIC:</span> this strike was estimated, not pulled from a real options chain. Verify in your broker.
      </div>
    </div>
  ),
  price: (
    <div>
      <div className="mb-1 font-bold">Current Stock Price</div>
      <div className="text-[#a1a1aa]">Live quote from the last market session. Used to calculate delta, breakeven, and entry status.</div>
    </div>
  ),
  direction: {
    CALL: (
      <div>
        <div className="mb-1 font-bold text-[#10b981]">CALL</div>
        Bullish bet. Profits if the stock rises above the strike + premium paid. Max loss = premium paid. Max gain = unlimited (theoretically).
      </div>
    ),
    PUT: (
      <div>
        <div className="mb-1 font-bold text-[#ef4444]">PUT</div>
        Bearish bet. Profits if the stock falls below the strike − premium paid. Max loss = premium paid. Max gain = strike price × 100.
      </div>
    ),
  },
  dataMode: {
    live: (
      <div>
        <div className="mb-1 font-bold text-[#10b981]">Live Data</div>
        Option contract data is pulled from the real options chain. Bid/ask, Greeks, and expiration are verified. Suitable for planning actual trades.
      </div>
    ),
    demo: (
      <div>
        <div className="mb-1 font-bold text-amber-400">Demo Data</div>
        Strike, expiration, and Greeks are estimated (synthetic). Not suitable for placing real trades. Verify everything in your broker before acting.
      </div>
    ),
    delayed: (
      <div>
        <div className="mb-1 font-bold text-[#ef4444]">Rate Limited</div>
        The data API hit its rate limit. Showing cached or estimated data. Wait for the cooldown and re-scan before making trading decisions.
      </div>
    ),
  },
  target: (
    <div>
      <div className="mb-1 font-bold">Price Targets</div>
      <div className="text-[#a1a1aa]">
        <div><span className="text-[#fafafa]">T1</span> — First target (resistance / 25–50% profit). Sell half here to lock gains.</div>
        <div className="mt-0.5"><span className="text-[#fafafa]">T2</span> — Full run target. Let remaining position ride with a trailing stop.</div>
      </div>
    </div>
  ),
  setupType: (s: string) => (
    <div>
      <div className="mb-1 font-bold">{s}</div>
      {{
        "Pullback-to-Support": "Stock pulled back to a key support level (50DMA, base, or pivot) and is showing signs of a bounce. Entry on reclaim.",
        "Pivot/Base Breakout": "Stock is breaking above a consolidation base or key pivot point with volume confirmation. Breakout entry.",
        "Pivot/Base Retest": "Stock broke out previously and is retesting the breakout level from above. Second-chance entry if level holds.",
        "Short-Term Momentum": "Strong relative strength vs SPY. Stock is trending above all DMAs with expanding volume. Entry on continuation.",
        "Failed Breakout": "Stock broke out but failed and reversed. Now trending lower. PUT setup on breakdown of support.",
        "Breakdown": "Stock has broken below key support with volume. Downtrend in progress. PUT entry on retest of broken support.",
        "LEAPS": "Long-dated option (180d+). Higher delta (0.60–0.80). Used for multi-month directional conviction plays.",
        "Reddit YOLO": "High-sentiment momentum play from social data. Very high risk. Size at 0.25% of account maximum.",
      }[s] ?? "Chart pattern setup identified by the scanner."}
    </div>
  ),
};
