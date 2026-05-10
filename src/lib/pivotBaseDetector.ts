import type { Levels } from "./types";

export type BaseState =
  | "inside-base"
  | "breaking-above"
  | "retesting-top"
  | "failing-pivot"
  | "reclaiming-pivot"
  | "below-base";

export function classifyBase(price: number, l: Levels): BaseState {
  if (price > l.baseHigh * 1.005) return "breaking-above";
  if (price >= l.baseHigh * 0.99 && price <= l.baseHigh * 1.005) return "retesting-top";
  if (price < l.baseLow) return "below-base";
  if (price < l.pivot && price > l.baseLow) return "failing-pivot";
  if (price >= l.pivot && price < l.baseHigh * 0.99) return "reclaiming-pivot";
  return "inside-base";
}
