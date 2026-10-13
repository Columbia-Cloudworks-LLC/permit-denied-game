import { SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { applyCellDamage, createBuildingFromArchetype, stepStructures } from "../structure/building";
import { cellPresent, type Building, type Cell } from "../structure/types";
import { createDozer, stepDozer } from "../vehicle/dozer";
import { createTown } from "../world/town";
import { stepWorld, type Upgrades } from "./worldSim";

export function freshWarehouse(): Building {
  return createBuildingFromArchetype("warehouse", "TEST SHED", 0, 0);
}

export function smashCorner(building: Building, amount = 999): void {
  const particles = new ParticlePool();
  const cell = building.grid[0]![0]![0]!;
  applyCellDamage(building, cell, amount, 1, 0, particles, []);
}

export function smashAllGround(building: Building): void {
  const particles = new ParticlePool();
  for (let gx = 0; gx < building.w; gx++) {
    for (let gy = 0; gy < building.d; gy++) {
      applyCellDamage(building, building.grid[0]![gx]![gy]!, 999, 0, 1, particles, []);
    }
  }
}

export function settle(building: Building, seconds: number): void {
  const particles = new ParticlePool();
  const steps = Math.ceil(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    stepStructures([building], SIM_DT, particles, []);
  }
}

export function presentCells(building: Building): number {
  return building.cells.filter((c) => cellPresent(c)).length;
}

export function floatingPresent(building: Building): boolean {
  return building.cells.some((cell) => {
    if (!cellPresent(cell) || cell.floor === 0) return false;
    const under = building.grid[cell.floor - 1]![cell.gx]![cell.gy]!;
    return !cellPresent(under) && !nearColumn(building, cell);
  });
}

/** Same-floor offsets within two grid steps. */
const NEAR_OFFSETS = [[-2, 0], [-1, -1], [-1, 0], [-1, 1], [0, -2], [0, -1], [0, 1], [0, 2], [1, -1], [1, 0], [1, 1], [2, 0]] as const;

/** True when a present cell within two steps on the same floor stands on a present cell. */
function nearColumn(building: Building, cell: Cell): boolean {
  return NEAR_OFFSETS.some(([dx, dy]) => {
    const nb = building.grid[cell.floor]![cell.gx + dx]?.[cell.gy + dy];
    return !!nb && cellPresent(nb) && cellPresent(building.grid[cell.floor - 1]![nb.gx]![nb.gy]!);
  });
}

export function driveIntoFirstHouse(seconds = 6): {
  damaged: number;
  intactStart: boolean;
  cash: number;
} {
  const town = createTown();
  const intactStart = town.buildings.every((b) => b.cells.every((c) => c.state === "intact"));
  const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
  const particles = new ParticlePool();
  const upgrades: Upgrades = { blade: 0, engine: 0, push: 0 };
  let cash = 0;
  const steps = Math.ceil(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    stepDozer(
      dozer,
      {
        throttle: 1,
        steer: 0,
        blade: true,
        engineMul: 1,
        bladeMul: 1,
        pushMul: 1,
      },
      SIM_DT,
    );
    const out = stepWorld(town, dozer, particles, upgrades, SIM_DT);
    cash += out.cash;
  }
  const house = town.buildings[0]!;
  const damaged = house.cells.filter((c) => c.state !== "intact").length;
  return { damaged, intactStart, cash };
}

export function restartResetsTown(): boolean {
  const a = createTown();
  smashAllGround(a.buildings[0]!);
  settle(a.buildings[0]!, 2);
  const b = createTown();
  return b.buildings.every((building) => building.cells.every((c) => c.state === "intact" && c.hp === c.maxHp));
}
