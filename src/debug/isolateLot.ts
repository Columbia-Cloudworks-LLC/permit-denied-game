import { CELL, FLOOR_Z } from '../game/constants';
import { createTown, type Town } from '../world/town';
import { bayBuildings, bayProps, bayVehicles, instantiateBay, type YardAsset, type YardBay } from '../world/yardCatalog';
import { PileField } from '../sim/pile';
import { emptyTerrain, RoadBuilder } from '../world/roads';
import { CATALOG_CAPTURE_DOZER } from './catalogCaptureDozer';
import { createDozer, type Dozer } from '../vehicle/dozer';
import { worldBoundsToScreen, type ScreenAabb } from '../world/iso';
import type { Archetype } from '../world/archetypes';
import type { WorldRenderer } from '../render/WorldRenderer';

export interface IsolateLot {
  town: Town;
  bay: YardBay;
  dozer: Dozer;
  camera: ScreenAabb;
  pad: number;
}

export function yardAssetFromDefinition(definition: Archetype): YardAsset {
  return {
    id: `building:${definition.id}`,
    name: definition.label,
    category: 'building',
    material: definition.construction.structure,
    destruction: `${definition.construction.walls} collapse`,
    variants: 1,
    w: definition.w * (definition.cellSize ?? CELL),
    d: definition.d * (definition.cellSize ?? CELL),
    clearance: Math.max(5, definition.floors * .55 + 3),
    archetype: definition,
  };
}

/** Same pad, off-lot dozer, and stripped town used by catalog capture. */
export function createIsolateLot(asset: YardAsset, variant = 0): IsolateLot {
  const town = createTown({ seed: 4517 });
  const pad = Math.max(12, asset.clearance);
  const bay: YardBay = {
    key: `capture:${asset.id}`,
    asset,
    variant,
    baseline: false,
    intactFacade: true,
    x: pad - asset.clearance,
    y: pad - asset.clearance,
    w: asset.w + pad * 2,
    d: asset.d + pad * 2,
  };
  instantiateBay(bay);
  town.buildings = bayBuildings(bay);
  town.props = bayProps(bay);
  town.vehicles = bayVehicles(bay);
  town.rubble = [];
  town.marks = [];
  town.collapsedSites = [];
  town.yard = undefined;
  town.lots = [];
  town.ground = [];
  town.roads = [];
  town.network = new RoadBuilder().finish();
  town.roadCar = null;
  town.minX = 0;
  town.minY = 0;
  town.maxX = asset.w + pad * 2;
  town.maxY = asset.d + pad * 2;
  town.pile = new PileField(0, 0, town.maxX + 2, town.maxY + 2);
  town.terrain = emptyTerrain(0, 0, town.maxX + 2, town.maxY + 2);
  town.debrisOwnerAt = () => bay.key;
  town.pile.ownerAt = town.debrisOwnerAt;
  const dozer = createDozer(CATALOG_CAPTURE_DOZER.x, CATALOG_CAPTURE_DOZER.y, CATALOG_CAPTURE_DOZER.heading);
  const height = Math.max(1, ...town.buildings.map(b => b.floors * FLOOR_Z + (b.elevatedTank ? b.elevatedTank.definition.height + .5 : 1.5)), asset.prop?.footprint.h ?? 0);
  const camera = worldBoundsToScreen(pad - 3, pad - 3, asset.w + 6, asset.d + 6, 0, height);
  return { town, bay, dozer, camera, pad };
}

export function frameIsolateLot(renderer: WorldRenderer, camera: ScreenAabb, viewW: number, viewH: number): void {
  renderer.zoom = Math.min(3, .88 * Math.min(viewW / (camera.maxX - camera.minX), viewH / (camera.maxY - camera.minY)));
  renderer.camX = (camera.minX + camera.maxX) / 2 * renderer.zoom;
  renderer.camY = (camera.minY + camera.maxY) / 2 * renderer.zoom;
}

export function instantiateIsolateDefinition(definition: Archetype): IsolateLot {
  return createIsolateLot(yardAssetFromDefinition(definition));
}
