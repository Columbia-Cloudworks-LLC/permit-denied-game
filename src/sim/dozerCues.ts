import { HARD_LOT_COVERS, SOFT_LOT_COVERS } from "../render/coverPalette";
import type { CoverKind, Material, WorldEvent } from "../structure/types";
import { dozerForward, dozerSpeed, type Dozer } from "../vehicle/dozer";
import { groundPatchContains, surfaceAt } from "../world/terrain";
import type { Town } from "../world/town";
import type { ParticlePool } from "../fx/particles";
import { addSurfaceMark } from "./debris";

const SOFT = new Set<CoverKind>(SOFT_LOT_COVERS);
const HARD = new Set<CoverKind>(HARD_LOT_COVERS);

export function coverAtPoint(town: Town, x: number, y: number): CoverKind | undefined {
  let best: { cover: CoverKind; z: number } | undefined;
  for (const patch of town.ground) {
    if (!groundPatchContains(patch, x, y)) continue;
    if (!best || patch.z >= best.z) best = { cover: patch.cover, z: patch.z };
  }
  if (best) return best.cover;
  if (!town.surface) return undefined;
  const surface = surfaceAt(town.surface, x, y);
  switch (surface) {
    case "grass":
      return "grass";
    case "scrub":
      return "scrub";
    case "dirt":
    case "wet-edge":
      return "dirt";
    case "prairie":
      return "grass";
    case "duff":
    case "leaf-litter":
    case "forest-floor":
    case "forest-core":
      return "forest-floor";
    case "gravel":
      return "gravel";
    case "field":
      return "planted";
    case "water":
      return "water";
    case "developed":
      return "lot";
    default: {
      const _never: never = surface;
      return _never;
    }
  }
}

export function emitDozerCues(
  town: Town,
  dozer: Dozer,
  particles: ParticlePool,
  events: WorldEvent[],
  dt: number,
): void {
  const speed = dozerSpeed(dozer);
  const cover = coverAtPoint(town, dozer.x, dozer.y);
  const f = dozerForward(dozer);
  const load = dozer.pushT > 0 || dozer.bladeDown;
  const moving = speed > 0.55;

  if (moving && (dozer.heat > 0.22 || load)) {
    const stackX = dozer.x - f.x * 0.72;
    const stackY = dozer.y - f.y * 0.72;
    const n = dozer.heat > 0.7 ? 2 : 1;
    particles.spawn("dust", stackX, stackY, 1.15 + dozer.heat * 0.35, n, 0.18 + speed * 0.04, 0.55);
  }

  if (moving && cover && SOFT.has(cover) && ((dozer.odo * 3) | 0) !== (((dozer.odo - speed * dt) * 3) | 0)) {
    const rx = -f.y;
    const ry = f.x;
    for (const side of [-1, 1] as const) {
      addSurfaceMark(
        town,
        dozer.x + rx * 0.55 * side,
        dozer.y + ry * 0.55 * side,
        "tire",
        "concrete",
        dozer.heading,
      );
    }
    particles.spawn("dust", dozer.x, dozer.y, 0.12, load ? 3 : 1, 0.35 + speed * 0.08, 0.7);
  }

  if (moving && cover && HARD.has(cover) && speed > 2.4 && ((dozer.odo * 2) | 0) !== (((dozer.odo - speed * dt) * 2) | 0)) {
    addSurfaceMark(town, dozer.x, dozer.y, "scrape", "concrete", dozer.heading);
    if (dozer.bladeDown) particles.spawn("concrete", dozer.x + f.x * 0.9, dozer.y + f.y * 0.9, 0.18, 1, 0.4, 0.9);
  }

  if (dozer.lastImpact > 0.12 && dozer.lastImpact + dt >= 0.2) {
    const hardHit = !cover || HARD.has(cover);
    particles.burst(hardHit ? "concrete" : "dust", dozer.x + f.x * 0.8, dozer.y + f.y * 0.8, 0.22, 0.35 + dozer.lastImpact * 0.25);
    if (hardHit) {
      addSurfaceMark(town, dozer.x + f.x * 0.7, dozer.y + f.y * 0.7, "scrape", impactMaterial(cover), dozer.heading);
      if (cover === "parking" || cover === "concrete") {
        particles.spawn("metal", dozer.x + f.x, dozer.y + f.y, 0.35, 2, 1.1, 2.4);
        events.push({ kind: "spark", x: dozer.x + f.x, y: dozer.y + f.y, z: 0.4, mag: 0.28, material: "metal" });
      }
    }
  }
}

function impactMaterial(cover: CoverKind | undefined): Material {
  if (cover === "dirt" || cover === "lot" || cover === "tracks") return "wood";
  if (cover === "parking" || cover === "concrete") return "concrete";
  return "concrete";
}
