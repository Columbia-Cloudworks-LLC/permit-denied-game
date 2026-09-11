import { createBuildingFromArchetype, resetBuildingIds } from '../structure/building';
import { PileField } from '../sim/pile';
import { emptyTerrain, RoadBuilder, linePoints, pt } from './roads';
import type { Town } from './town';

export function populateTowerTest(town: Town): Town {
  resetBuildingIds();
  const tower = createBuildingFromArchetype('union-tower', 'UNION TOWER', 34, 30);
  town.buildings = [tower]; town.props = []; town.lots = []; town.ground = [];
  town.rubble = []; town.marks = []; town.collapsedSites = []; town.roadCar = null;
  town.minX = 0; town.minY = 0; town.maxX = 84; town.maxY = 84;
  town.pile = new PileField(0, 0, 86, 86); town.terrain = emptyTerrain(0, 0, 86, 86);
  town.ground.push({ x: 12, y: 12, w: 60, d: 60, heading: 0, cover: 'concrete', seed: town.seed, z: 0 });
  const roads = new RoadBuilder(), a = roads.node(4, 66), b = roads.node(80, 66);
  roads.segment(a, b, linePoints(pt(a), pt(b)), { roadClass: 'service', width: 4 });
  town.network = roads.finish(); town.roads = [{ x: 4, y: 64, w: 76, d: 4 }];
  town.spawnX = tower.x + tower.w * tower.cellSize / 2;
  town.spawnY = tower.y + tower.d * tower.cellSize + 4; town.spawnHeading = -Math.PI / 2;
  town.roadSpawnX = 10; town.roadSpawnY = 66; town.roadSpawnHeading = 0;
  town.debrisOwnerAt = () => 'tower-test'; town.pile.ownerAt = town.debrisOwnerAt;
  return town;
}
