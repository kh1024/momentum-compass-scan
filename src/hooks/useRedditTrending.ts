import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  fetchRedditTrending,
  type RedditTrendingResult,
} from "@/lib/redditTrending.functions";

export function useRedditTrending(limit: number = 60) {
  const fn = useServerFn(fetchRedditTrending);
  const q = useQuery<RedditTrendingResult>({
    queryKey: ["reddit-trending", limit],
    queryFn: () => fn({ data: { limit } }),
    // Server caches 20 min; poll the client every 15 min.
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
  return {
    data: q.data,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: () => void q.refetch(),
  };
}
