import { testVehicleImpact } from "../world/testYard";
import { applyFixtureDamage } from "../structure/interior";
import { bayBuildings, bayProps, bayVehicles, type YardBay } from "../world/yardCatalog";
import { YardPanel } from "../render/yardPanel";
import { applyCellDamage } from "../structure/building";
import { destroyProp } from "../sim/assets";
import { spawnFixtureFrags } from "../sim/worldSim";
import type { ParticlePool } from "../fx/particles";
import type { Dozer } from "../vehicle/dozer";
import type { Town } from "../world/town";
import type { DebugBinderState } from "../debug/binderState";

export interface YardPanelBindings {
  town: () => Town;
  particles: ParticlePool;
  dozer: () => Dozer;
  jump: (x: number, y: number) => void;
  frame: (bay: YardBay) => void;
  followVehicle: (bay: YardBay) => void;
  testAsset: (assetId: string, variant: number) => void;
  releaseInput: () => void;
  preview: (bays: YardBay[], valid: boolean) => void;
  changed: () => void;
}

export function attachYardPanel(
  hudRoot: HTMLElement,
  host: YardPanelBindings,
  binder: DebugBinderState,
): YardPanel {
  const panel = new YardPanel(hudRoot, {
    town: host.town,
    particles: host.particles,
    dozer: host.dozer,
    jump: host.jump,
    frame: host.frame,
    followVehicle: host.followVehicle,
    testAsset: host.testAsset,
    releaseInput: host.releaseInput,
    preview: host.preview,
    changed: host.changed,
    destroy: (bay) => {
      for (const vehicle of bayVehicles(bay)) for (let i = 0; i < 5; i++) testVehicleImpact(vehicle, "overhead", 20);
      for (const prop of bayProps(bay)) if (!prop.broken) destroyProp(host.town(), prop, host.particles, [], prop.x - 1, prop.y);
      if (bay.building && bay.asset.fixture) {
        for (const fixture of bay.building.fixtures) {
          const hit = applyFixtureDamage(bay.building, fixture, 10000, 1, 0, host.particles, []);
          spawnFixtureFrags(host.town(), hit.frags);
        }
      } else {
        for (const building of bayBuildings(bay)) {
          for (const cell of building.cells) applyCellDamage(building, cell, 10000, 1, 0, host.particles, []);
        }
      }
    },
  }, binder);
  return panel;
}
