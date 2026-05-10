import { Star } from "lucide-react";
import { useWatchlist, snapshotFromCandidate, watchlistKey } from "@/hooks/useWatchlist";
import type { TradeCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";

export function WatchlistButton({ t, size = "sm" }: { t: TradeCandidate; size?: "sm" | "md" }) {
  const { has, add, remove } = useWatchlist();
  const id = watchlistKey(t);
  const saved = has(id);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (saved) remove(id);
    else add(snapshotFromCandidate(t));
  };

  const px = size === "md" ? "px-2.5 py-1.5" : "px-1.5 py-1";
  const iconSize = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <button
      type="button"
      onClick={onClick}
      title={saved ? "Remove from watchlist" : "Add to watchlist"}
      aria-label={saved ? "Remove from watchlist" : "Add to watchlist"}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border transition-colors",
        px,
        saved
          ? "border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
          : "border-border bg-background/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      <Star className={cn(iconSize, saved && "fill-current")} />
    </button>
  );
}
