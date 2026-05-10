import type { Direction } from "./types";

export function chainPickKey(
  ticker: string,
  direction: Direction,
  opts?: { isLeaps?: boolean; isYolo?: boolean; entryMode?: string; selectedExpiration?: string },
): string {
  const style = opts?.isLeaps ? "LEAPS" : opts?.isYolo ? "YOLO" : "STD";
  const entry = opts?.entryMode ? `:${opts.entryMode.replace(/\s+/g, "-").toUpperCase()}` : "";
  const exp = opts?.selectedExpiration ? `:EXP=${opts.selectedExpiration}` : "";
  return `${ticker.trim().toUpperCase()}:${direction}:${style}${entry}${exp}`;
}