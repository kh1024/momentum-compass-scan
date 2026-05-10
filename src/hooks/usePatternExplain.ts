import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { explainPattern } from "@/lib/patternExplain.functions";

export function usePatternExplain(args: {
  ticker: string;
  pattern: string;
  bias: "Bullish" | "Bearish";
  trigger?: number;
  target?: number;
  enabled: boolean;
}) {
  const fn = useServerFn(explainPattern);
  return useQuery({
    queryKey: ["pattern-explain", args.ticker, args.pattern, args.bias],
    queryFn: () =>
      fn({
        data: {
          ticker: args.ticker,
          pattern: args.pattern,
          bias: args.bias,
          trigger: args.trigger,
          target: args.target,
        },
      }),
    enabled: args.enabled,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });
}
