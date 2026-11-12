import type { Cell, RooftopFixture, SalvageKind } from "./types";

export function cashFor(cell: Cell, kind: "chip" | "breach" | "collapse"): number {
  const base =
    cell.material === "concrete" ? 18 : cell.material === "brick" ? 14 : cell.material === "metal" ? 16 : 10;
  if (kind === "chip") return 3 + (cell.isSupport ? 2 : 0);
  if (kind === "breach") return base + (cell.isSupport ? 12 : 0) + cell.floor * 4;
  return base + 16 + cell.floor * 8 + (cell.isSupport ? 20 : 0);
}

/** Scrap value of a wrecked machine by its salvageable mass: copper coils pay more per unit than mixed steel. */
export function salvageCash(kind: SalvageKind, scrap: number): number {
  const raw = kind === "copper" ? 20 + scrap * 24 : 18 + scrap * 14;
  return Math.round(raw / 5) * 5;
}

/** Scrap still standing on a building's roofs. */
export function rooftopSalvage(rooftop: readonly RooftopFixture[]): number {
  let cash = 0;
  for (const fixture of rooftop) if (fixture.state !== "gone") cash += fixture.value;
  return cash;
}
