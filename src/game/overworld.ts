/**
 * The North American overworld, loaded on demand (see `overworldLoader.ts`): region manifest,
 * county generator, regional flavor data, progress store, and map markup. Nothing in the
 * startup graph may import this module statically, or the chunk folds back into the initial JS.
 */
import { countyAt, regionBiome } from '../world/counties';
import { regionalPlacement } from '../world/regionalCatalog';
import { regionById } from '../world/regions';
import type { SessionRules } from './session';

export { CountyProgress } from './countyProgress';
export { countyAt, countyId, countySeed, countyWeather, regionBiome, regionCounties } from '../world/counties';
export { regionalPlacement } from '../world/regionalCatalog';
export { regionById, REGIONS, searchRegions } from '../world/regions';
export { countyCardHtml, countyListHtml, countySvg, escapeHtml, overworldSvg, regionListHtml, type CountyViewState } from '../render/overworldMap';

/**
 * Fill a parsed county link from the manifest: its level, seed, and regional biome, unless the
 * link names those itself. An unknown region drops the county fields so the link plays as before.
 */
export function resolveCountyLink(rules: SessionRules, search: string): void {
  if (!rules.regionId || !rules.countyIndex) return;
  const county = countyAt(rules.regionId, rules.countyIndex);
  const region = regionById(rules.regionId);
  if (!county || !region) {
    delete rules.regionId;
    delete rules.countyIndex;
    return;
  }
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (!params.has('level')) rules.level = county.level.id;
  if (!params.has('seed')) rules.seed = county.seed;
  if (!params.has('biome')) rules.biomeId = regionBiome(region);
}

/** Regional flavor for the rules' county; none on legacy level links. */
export function placementForRules(rules: Pick<SessionRules, 'regionId' | 'countyIndex'>) {
  const region = regionById(rules.regionId);
  return region && rules.countyIndex ? regionalPlacement(region.flavor, rules.countyIndex) : undefined;
}
