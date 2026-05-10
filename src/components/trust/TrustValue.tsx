import { cn } from "@/lib/utils";
import type { TrustEnvelope } from "@/services/trust";

interface TrustValueProps {
  envelope: TrustEnvelope<unknown> | null | undefined;
  /** Render fn receives the validated value when present. */
  render: (value: never) => React.ReactNode;
  /** Override the unavailable text. */
  unavailableText?: string;
  className?: string;
}

/**
 * Render a value ONLY when the envelope is usable. Otherwise show a clean
 * unavailable state — never a fake number, never zero, never a dash that
 * implies "no change".
 */
export function TrustValue<T>({
  envelope,
  render,
  unavailableText = "—",
  className,
}: Omit<TrustValueProps, "render"> & { render: (value: T) => React.ReactNode }) {
  if (!envelope || envelope.value == null || !envelope.validated) {
    return (
      <span className={cn("text-muted-foreground/50", className)} title={envelope?.error?.message}>
        {unavailableText}
      </span>
    );
  }
  return <>{render(envelope.value as T)}</>;
}
