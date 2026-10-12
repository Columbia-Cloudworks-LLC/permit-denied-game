import type { Cell } from "./types";

export function cashFor(cell: Cell, kind: "chip" | "breach" | "collapse"): number {
  const base =
    cell.material === "concrete" ? 18 : cell.material === "brick" ? 14 : cell.material === "metal" ? 16 : 10;
  if (kind === "chip") return 3 + (cell.isSupport ? 2 : 0);
  if (kind === "breach") return base + (cell.isSupport ? 12 : 0) + cell.floor * 4;
  return base + 16 + cell.floor * 8 + (cell.isSupport ? 20 : 0);
}
