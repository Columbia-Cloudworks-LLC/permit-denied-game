import type { CityPlan } from '../cityPlan';
import { CHICAGO } from './chicago';
import { LAS_VEGAS } from './lasVegas';
import { MILWAUKEE } from './milwaukee';
import { NEW_YORK_CITY } from './newYorkCity';

/** The Downtown county (County 6) is the one a city plan replaces. */
export const CITY_PLAN_COUNTY_INDEX = 6;

/**
 * Authored cities by region. To tailor a region's Downtown: write its plan here, add its landmark
 * packages under `landmarkData/`, and list its coordinates in `cityPlanSites.ts` so the state sheet
 * pins the county to the real place (then rebuild the atlas). See docs/city-plans.md.
 */
export const CITY_PLANS: Readonly<Record<string, CityPlan>> = {
  'US-IL': CHICAGO,
  'US-NV': LAS_VEGAS,
  'US-NY': NEW_YORK_CITY,
  'US-WI': MILWAUKEE,
};

export function cityPlanFor(regionId: string | undefined, countyIndex: number): CityPlan | undefined {
  return regionId && countyIndex === CITY_PLAN_COUNTY_INDEX ? CITY_PLANS[regionId] : undefined;
}
