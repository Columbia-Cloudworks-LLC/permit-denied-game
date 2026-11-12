import { hashSeed, mixSeed, Rng } from "../game/rng";
import type { ClimateEnvelope, RoofRegion, SoilId, WallRegion } from "../world/climate";
import { onRoof } from "./facadeDetails";
import { generateRoofs } from "./roof";
import { generateRooftop } from "./rooftop";
import type { Building, RoofForm } from "./types";

/** The regional dress one building wears: which roof silhouettes and wall palettes its climate zone favours. */
export interface RegionalExterior {
  roofs: RoofRegion;
  walls: WallRegion;
  soil: SoilId;
  /** Per-building roll: stable for a town seed and footprint, independent of generation order. */
  seed: number;
}

function regionalSeed(building: Pick<Building, "archetypeId" | "x" | "y">, townSeed: number): number {
  return hashSeed(`${building.archetypeId}:${Math.round(building.x * 8)}:${Math.round(building.y * 8)}:${townSeed >>> 0}`);
}

type FormId = RoofForm["id"];
const FORMS: Record<FormId, RoofForm> = {
  "barrel-tile-gable": { id: "barrel-tile-gable", covering: "barrel-tile", rise: 0.5, hip: false, vigas: false },
  "adobe-flat": { id: "adobe-flat", covering: "adobe", rise: 0, hip: false, vigas: true },
  "hip-metal": { id: "hip-metal", covering: "metal-seam", rise: 0.62, hip: true, vigas: false },
  "hip-tile": { id: "hip-tile", covering: "barrel-tile", rise: 0.56, hip: true, vigas: false },
  "cool-flat": { id: "cool-flat", covering: "metal-seam", rise: 0, hip: false, vigas: false },
};

/** Residential, hospitality and low civic roofs that follow the climate; everything else keeps its authored roof. */
const PITCHED_HOSTS: ReadonlySet<string> = new Set(["ranch", "cottage", "porch-house", "community-hall"]);
const FLAT_HOSTS: ReadonlySet<string> = new Set(["motel-room-block", "neighborhood-clinic"]);

type FormWeights = readonly (readonly [FormId | "classic", number])[];
const ROOF_WEIGHTS: Record<RoofRegion, { pitched: FormWeights; flat: FormWeights }> = {
  southwest: {
    pitched: [["barrel-tile-gable", 45], ["adobe-flat", 45], ["classic", 10]],
    flat: [["adobe-flat", 60], ["barrel-tile-gable", 40]],
  },
  subtropical: {
    pitched: [["hip-metal", 45], ["hip-tile", 35], ["classic", 20]],
    flat: [["cool-flat", 50], ["hip-metal", 30], ["hip-tile", 20]],
  },
  temperate: { pitched: [["classic", 1]], flat: [["classic", 1]] },
};

/**
 * The roof silhouette a climate rolls for one building: undefined keeps the archetype's own roof
 * (always, in temperate zones and for archetypes outside the regional set).
 */
export function regionalRoofForm(archetypeId: string, roofs: RoofRegion, seed: number): RoofForm | undefined {
  const weights = PITCHED_HOSTS.has(archetypeId) ? ROOF_WEIGHTS[roofs].pitched : FLAT_HOSTS.has(archetypeId) ? ROOF_WEIGHTS[roofs].flat : undefined;
  if (!weights) return undefined;
  let pick = new Rng(mixSeed(seed ^ 0x700f)).range(0, weights.reduce((n, [, w]) => n + w, 0));
  for (const [id, weight] of weights) {
    pick -= weight;
    if (pick <= 0) return id === "classic" ? undefined : FORMS[id];
  }
  return undefined;
}

/** Swap an intact building's roof for a regional form: new sections, parapet and chimney to match. */
function applyRoofForm(building: Building, form: RoofForm): void {
  const flat = form.rise === 0;
  building.roofForm = form;
  building.roof = flat ? "flat" : "gable";
  building.features = { ...building.features, parapet: flat, chimney: false };
  building.decorBoxes = building.decorBoxes.filter(box => box.kind !== "chimney" && (flat || box.kind !== "parapet"));
  building.roofs = generateRoofs(building);
  building.roofDirty = false;
}

/**
 * Dress every building of a generated town for its climate zone. Runs once on the finished
 * layout, before brand stamping. Footprints, cells and collision never change here; temperate
 * zones keep every roof and rooftop exactly as built.
 */
export function stampRegionalExterior(buildings: readonly Building[], climate: ClimateEnvelope, townSeed: number): void {
  for (const building of buildings) {
    const seed = regionalSeed(building, townSeed);
    building.region = { roofs: climate.roofs, walls: climate.walls, soil: climate.soil, seed };
    building.visualRevision++;
    if (climate.roofs === "temperate" || building.retired || building.coreCollapse || building.facadeDetails.some(onRoof)) continue;
    const form = regionalRoofForm(building.archetypeId, climate.roofs, seed);
    if (form) applyRoofForm(building, form);
    if (form || PITCHED_HOSTS.has(building.archetypeId) || FLAT_HOSTS.has(building.archetypeId)) {
      building.rooftop = generateRooftop(building, seed, climate.roofs);
    }
  }
}
