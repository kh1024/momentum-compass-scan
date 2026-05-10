import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { massiveConfigured, getMassiveCooldownStatus, isMassiveEnabled } from "./massive.server";
import { getPublicCooldownStatus } from "./publicCom.server";
import {
  getConsensusQuotes, probeAllProviders,
  type ConsensusQuote, type ProviderHealth,
} from "./providers.server";

export interface ProviderStatus {
  massive: { configured: boolean; live: boolean; error?: string };
  providers: ProviderHealth[];
  anyLive: boolean;
}

export const getProviderStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<ProviderStatus> => {
    const providers = await probeAllProviders();
    const massive = providers.find(p => p.source === "massive");
    const anyLive = providers.some(p => p.ok);
    return {
      massive: {
        configured: massiveConfigured(),
        live: Boolean(massive?.ok),
        error: massive?.error,
      },
      providers,
      anyLive,
    };
  },
);

const QuotesInput = z.object({ symbols: z.array(z.string().min(1).max(10)).min(1).max(50) });

export interface QuotesResponse {
  quotes: Record<string, ConsensusQuote | null>;
  live: boolean;
  /** Largest active cooldown across providers (ms). 0 when none. */
  cooldownMs: number;
  /** True if Massive is currently disabled or cooling down. */
  massiveBlocked: boolean;
}

export const getQuotes = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => QuotesInput.parse(data))
  .handler(async ({ data }): Promise<QuotesResponse> => {
    const quotes = await getConsensusQuotes(data.symbols);
    const live = Object.values(quotes).some(q => q !== null);
    const m = getMassiveCooldownStatus();
    const p = getPublicCooldownStatus();
    const cooldownMs = Math.max(m.remainingMs, p.remainingMs);
    const massiveBlocked = !isMassiveEnabled() || m.rateLimited;
    return { quotes, live, cooldownMs, massiveBlocked };
  });
