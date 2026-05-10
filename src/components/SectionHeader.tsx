import type { ReactNode } from "react";

export function SectionHeader({ title, subtitle, count, action }: { title: string; subtitle?: string; count?: number; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">
          {title}
          {typeof count === "number" && (
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{count}</span>
          )}
        </h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptySection({ message = "No clean trades — wait for trigger." }: { message?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
