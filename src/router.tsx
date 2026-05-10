import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Exponential backoff with jitter, capped at 30s.
        // ~1s, 2s, 4s, 8s before giving up (4 retries).
        retry: (failureCount, error) => {
          const status = (error as { status?: number })?.status;
          // Don't retry on permanent client errors (4xx except transient).
          if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
            return false;
          }
          return failureCount < 4;
        },
        retryDelay: (attempt) => {
          const base = Math.min(1000 * 2 ** attempt, 30_000);
          const jitter = base * 0.3 * (Math.random() * 2 - 1);
          return Math.max(250, Math.round(base + jitter));
        },
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
