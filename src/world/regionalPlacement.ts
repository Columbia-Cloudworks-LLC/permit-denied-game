import type { Building } from '../structure/types';
import type { CountyArchetype, RegionalFlavor } from './regionalCatalog';

/**
 * The part of regional flavor that layout generation runs. It stays in the startup bundle and
 * takes its data from the lazily loaded overworld (`regionalCatalog.ts`), so town generation
 * never needs the 63-region manifest on ordinary links.
 */
export interface RegionalPlacement {
  flavor: Pick<RegionalFlavor, 'boosts' | 'signatures'>;
  archetype: Pick<CountyArchetype, 'boosts' | 'signatures'>;
}

/** Extra collapse payout on a tagged signature building. */
export const SIGNATURE_BONUS = 600;
export const MAX_SIGNATURES = 2;

/** Weight multiplier for one building; regional and county boosts compound. */
export function regionalWeight(placement: RegionalPlacement | undefined, buildingId: string): number {
  if (!placement) return 1;
  return (placement.flavor.boosts[buildingId] ?? 1) * (placement.archetype.boosts[buildingId] ?? 1);
}

/**
 * Tag up to two placed buildings as the county's regional signatures:
 * region picks first, then the county archetype's, one building per ID. Landmarks never count.
 */
export function tagRegionalSignatures(buildings: readonly Building[], placement: RegionalPlacement | undefined): Building[] {
  if (!placement) return [];
  const tagged: Building[] = [];
  for (const spec of [...placement.flavor.signatures, ...placement.archetype.signatures]) {
    if (tagged.length >= MAX_SIGNATURES) break;
    if (tagged.some(building => building.archetypeId === spec.buildingId)) continue;
    const building = buildings.find(entry => entry.archetypeId === spec.buildingId && !entry.campaignLandmark && !entry.regionalSignature);
    if (!building) continue;
    building.regionalSignature = spec.label;
    tagged.push(building);
  }
  return tagged;
}
