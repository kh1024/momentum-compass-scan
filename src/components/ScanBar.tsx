import { cn } from "@/lib/utils";

export interface ScanBarProps {
  lastScanAt: number | null;
  dataMode: "live" | "cached" | "delayed" | "demo";
  isScanning: boolean;
  onRunScan: () => void;
}

function fmtTime(ts: number | null): string {
  if (!ts) return null as unknown as string;
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit" });
}

export function ScanBar({ lastScanAt, dataMode, isScanning, onRunScan }: ScanBarProps) {
  const modeColor =
    dataMode === "live"    ? "text-[var(--color-bull)] border-[var(--color-bull)]/40 bg-[var(--color-bull)]/5"
    : dataMode === "cached"  ? "text-[var(--color-watch)] border-[var(--color-watch)]/40 bg-[var(--color-watch)]/5"
    : dataMode === "delayed" ? "text-amber-500 border-amber-500/40 bg-amber-500/5"
    :                          "text-muted-foreground border-border bg-muted/20";

  const scanLabel = fmtTime(lastScanAt);

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-2.5">
      <div className="flex items-center gap-3 text-xs">
        <span className={cn("rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest", modeColor)}>
          {dataMode === "demo" ? "Snapshot" : dataMode === "delayed" ? "Rate Limited" : dataMode === "cached" ? "Cached" : "Live"}
        </span>
        <span className="text-muted-foreground">
          {scanLabel
            ? <span>Last scan <span className="font-semibold text-foreground mono">{scanLabel}</span></span>
            : <span className="italic">Not scanned yet — click Run Scan</span>
          }
        </span>
        <span className="text-muted-foreground/50">·</span>
        <span className="text-muted-foreground text-[11px]">Scans run manually or once per hour</span>
      </div>
      <button
        onClick={onRunScan}
        disabled={isScanning}
        className="rounded-md border border-[var(--color-bull)] bg-[var(--color-bull)]/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-bull)] transition hover:bg-[var(--color-bull)]/20 disabled:opacity-50"
      >
        {isScanning ? "Scanning…" : "Run Scan"}
      </button>
    </div>
  );
}
