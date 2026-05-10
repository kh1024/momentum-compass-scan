import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/watchlist")({
  head: () => ({ meta: [{ title: "Watchlist — Momentum Options Scanner" }] }),
  component: Watchlist,
});

function Watchlist() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold tracking-tight">Watchlist</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Save candidates, track whether the trigger fired, and log win/loss outcomes. Persistence + tracking ship in Phase 2.
      </p>
      <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No saved candidates yet.
      </div>
    </div>
  );
}
