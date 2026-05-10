import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchEarningsCalendar, finnhubConfigured, type FinnhubEarningsEvent } from "./finnhub.server";

export interface UpcomingEarnings {
  symbol: string;
  date: string;        // YYYY-MM-DD (next event)
  hour: string;        // bmo | amc | dmh | ""
  daysUntil: number;   // calendar days from today
  epsEstimate: number | null;
}

const Input = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(50),
  daysAhead: z.number().int().min(1).max(180).optional(),
});

function daysUntil(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!isFinite(t)) return Infinity;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((t - today) / 86_400_000);
}

function pickNext(events: FinnhubEarningsEvent[]): UpcomingEarnings | null {
  const future = events
    .map((e) => ({ e, d: daysUntil(e.date) }))
    .filter((x) => x.d >= 0 && isFinite(x.d))
    .sort((a, b) => a.d - b.d)[0];
  if (!future) return null;
  return {
    symbol: future.e.symbol,
    date: future.e.date,
    hour: future.e.hour,
    daysUntil: future.d,
    epsEstimate: future.e.epsEstimate,
  };
}

export const getUpcomingEarnings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<{
    configured: boolean;
    earnings: Record<string, UpcomingEarnings | null>;
  }> => {
    const out: Record<string, UpcomingEarnings | null> = {};
    if (!finnhubConfigured()) return { configured: false, earnings: out };
    const days = data.daysAhead ?? 60;
    const uniq = Array.from(new Set(data.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
    await Promise.all(uniq.map(async (sym) => {
      const evts = await fetchEarningsCalendar(sym, days);
      out[sym] = pickNext(evts);
    }));
    return { configured: true, earnings: out };
  });
