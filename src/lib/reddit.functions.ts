import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRedditSignals, type RedditSignal } from "./reddit.server";

const Input = z.object({ symbols: z.array(z.string().min(1).max(10)).min(1).max(50) });

export type { RedditSignal };

export const getRedditSentiment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<{ signals: Record<string, RedditSignal> }> => {
    try {
      const signals = await getRedditSignals(data.symbols);
      return { signals };
    } catch (e) {
      console.warn("[reddit.functions] failed", e);
      return { signals: {} };
    }
  });
