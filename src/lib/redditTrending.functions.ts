import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getRedditTrending,
  type RedditTrendingResult,
} from "./redditTrending.server";

export type {
  RedditTrendingEntry,
  RedditTrendingResult,
  TrendingCategory,
  TrendingSentiment,
} from "./redditTrending.server";

const Input = z.object({ limit: z.number().int().min(10).max(120).optional() });

export const fetchRedditTrending = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d ?? {}))
  .handler(async ({ data }): Promise<RedditTrendingResult> => {
    try {
      return await getRedditTrending(data.limit ?? 60);
    } catch (e) {
      console.warn("[redditTrending.functions] failed", e);
      return {
        entries: [],
        fetchedAt: Date.now(),
        sourcesUsed: [],
        sourcesFailed: [],
        aiAvailable: false,
        error: e instanceof Error ? e.message : "Reddit signal provider unavailable",
      };
    }
  });
