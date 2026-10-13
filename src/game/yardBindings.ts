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
import type { Building } from "../structure/types";
import type { VehicleState } from "../vehicle/types";
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
    destroy: (bay) => destroyBay(host, bay),
  }, binder);
  return panel;
}

/** Wreck everything a bay holds: crush its vehicles, break its props, and destroy its fixtures or buildings. */
function destroyBay(host: YardPanelBindings, bay: YardBay): void {
  for (const vehicle of bayVehicles(bay)) crushVehicle(vehicle);
  breakProps(host, bay);
  destroyStructures(host, bay);
}

function breakProps(host: YardPanelBindings, bay: YardBay): void {
  for (const prop of bayProps(bay)) if (!prop.broken) destroyProp(host.town(), prop, host.particles, [], prop.x - 1, prop.y);
}

/** A fixture test breaks its fixtures and spares the host room; anything else is flattened. */
function destroyStructures(host: YardPanelBindings, bay: YardBay): void {
  if (bay.building && bay.asset.fixture) breakFixtures(host, bay.building);
  else for (const building of bayBuildings(bay)) flattenBuilding(host, building);
}

/** Five heavy overhead loads wreck any yard vehicle. */
function crushVehicle(vehicle: VehicleState): void {
  for (let i = 0; i < 5; i++) testVehicleImpact(vehicle, "overhead", 20);
}

function breakFixtures(host: YardPanelBindings, building: Building): void {
  for (const fixture of building.fixtures) {
    const hit = applyFixtureDamage(building, fixture, 10000, 1, 0, host.particles, []);
    spawnFixtureFrags(host.town(), hit.frags);
  }
}

function flattenBuilding(host: YardPanelBindings, building: Building): void {
  for (const cell of building.cells) applyCellDamage(building, cell, 10000, 1, 0, host.particles, []);
}
