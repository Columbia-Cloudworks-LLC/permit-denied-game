import { buildingBonus, cashFor } from '../structure/building';
import type { Building } from '../structure/types';
import { getAsset } from '../world/catalog';
import type { Town } from '../world/town';

export function availableBuildingValue(building: Building): number {
  let cash = building.collapseBonusPaid ? 0 : buildingBonus(building);
  for (const cell of building.cells) {
    if (cell.state === 'gone') continue;
    cash += cashFor(cell, 'collapse');
  }
  return cash;
}

export function availableTownValue(town: Town): number {
  let cash = town.buildings.reduce((sum, building) => sum + availableBuildingValue(building), 0);
  for (const prop of town.props) {
    if (prop.broken) continue;
    cash += getAsset(prop.assetId).cash;
  }
  return cash;
}

export function landmarkShare(town: Town, landmarkIds: readonly string[]): number {
  return town.buildings
    .filter(building => building.campaignLandmark || landmarkIds.includes(building.archetypeId))
    .reduce((sum, building) => sum + availableBuildingValue(building), 0);
}
