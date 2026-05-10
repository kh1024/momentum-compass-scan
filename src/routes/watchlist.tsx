import { createFileRoute } from "@tanstack/react-router";
import { Star, Plus } from "lucide-react";

export const Route = createFileRoute("/watchlist")({
  head: () => ({ meta: [{ title: "Watchlist — Momentum Scanner" }] }),
  component: Watchlist,
});

function Watchlist() {
  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Watchlist</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Save candidates and track whether the trigger fired.
          </p>
        </div>
        <button
          disabled
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm font-medium text-[var(--color-muted-foreground)] opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add ticker
        </button>
      </div>

      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-[var(--color-border)] py-24">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-accent)]">
          <Star className="h-6 w-6 text-[var(--color-muted-foreground)]" />
        </div>
        <div className="text-center">
          <p className="font-semibold">No saved candidates yet</p>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Open any trade from the Scanner and save it to your watchlist.
          </p>
        </div>
      </div>
    </div>
  );
}
