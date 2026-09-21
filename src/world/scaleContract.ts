import { CELL, DOZER, FLOOR_Z } from "../game/constants";
import { vehicleDefinition } from "../vehicle/definitions";
import { widthFor } from "./roads";

/** Canonical world-scale cues. Visual assets should read against these, not a second unit system. */
export const SCALE_CONTRACT = {
  cell: CELL,
  storyHeight: FLOOR_Z,
  doorWidth: CELL,
  dozer: { length: DOZER.length, width: DOZER.width },
  sedan: { length: 2.25, width: 1.1 },
  pickup: { length: 2.9, width: 1.3 },
  excavator: { length: 2.85, width: 1.55 },
  lane: {
    rural: widthFor("rural"),
    residential: widthFor("residential"),
    commercial: widthFor("commercial"),
    driveway: widthFor("driveway"),
  },
} as const;

export function scaleReferenceVehicles(): {
  id: string;
  length: number;
  width: number;
}[] {
  return ["car", "pickup", "excavator"].map((id) => {
    const def = vehicleDefinition(id);
    return { id, length: def.length, width: def.width };
  });
}
