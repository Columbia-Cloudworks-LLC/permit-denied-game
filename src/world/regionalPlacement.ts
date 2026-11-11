import type { Building, Prop } from '../structure/types';
import type { CountyArchetype, RegionalFlavor } from './regionalCatalog';

/** A landmark the county plays instead of its level's civic one; same shape as `CampaignLandmarkSpec`. */
export interface RegionalLandmark {
  buildingId: string;
  label: string;
  structureIds: readonly string[];
}

/**
 * A regional facsimile establishment: a parody chain painted onto an existing host building.
 * It adds no geometry; stamping renames the host, colours its fascia and mounts or recolours a sign.
 */
export interface BrandSpec {
  /** Unique slug, e.g. `kaseys-general`. Also the Trophy Lot souvenir key. */
  id: string;
  /** Display name on HUD callouts and county dossier cards. */
  label: string;
  /** Sign lettering: `/^[A-Z0-9 ]{1,16}$/`. */
  signText: string;
  /** Archetype ids this brand may be painted onto. */
  hostBuildingIds: readonly string[];
  faceColor: number;
  trimColor: number;
  textColor: number;
  fasciaColor: number;
  /** Limits beyond the flavors that list the brand. */
  countries?: readonly ('US' | 'CA')[];
  /** Regions that put this brand first. */
  regionIds?: readonly string[];
}

/** What the lazy regional pass may touch on a finished layout. */
export interface RegionalLayout {
  buildings: Building[];
  props: Prop[];
}

/**
 * The part of regional flavor that layout generation runs. It stays in the startup bundle and
 * takes its data from the lazily loaded overworld (`regionalCatalog.ts`), so town generation
 * never needs the 63-region manifest on ordinary links.
 */
export interface RegionalPlacement {
  flavor: Pick<RegionalFlavor, 'boosts' | 'signatures'>;
  archetype: Pick<CountyArchetype, 'boosts' | 'signatures'>;
  /** Regional landmark for this county; absent keeps the level's own. */
  landmark?: RegionalLandmark;
  /** Brand skins this county may stamp, best match first. */
  brands?: readonly BrandSpec[];
  /**
   * Runs once on the finished layout, after signatures are tagged: brand stamping and landmark
   * dressing (`regionalBrands.ts`, in the lazy overworld chunk). Seeded, so a county and its replay match.
   */
  finish?: (layout: RegionalLayout, seed: number) => void;
}

/** Extra collapse payout on a tagged signature building. */
export const SIGNATURE_BONUS = 600;
export const MAX_SIGNATURES = 2;

/** Weight multiplier for one building; regional and county boosts compound. */
export function regionalWeight(placement: RegionalPlacement | undefined, buildingId: string): number {
  if (!placement) return 1;
  return (placement.flavor.boosts[buildingId] ?? 1) * (placement.archetype.boosts[buildingId] ?? 1);
}

/** The level as this county plays it: its regional landmark when the region overrides the civic one. */
export function regionalLevel<T extends { landmark: RegionalLandmark }>(level: T, placement: Pick<RegionalPlacement, 'landmark'> | undefined): T {
  return placement?.landmark ? { ...level, landmark: placement.landmark } : level;
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
