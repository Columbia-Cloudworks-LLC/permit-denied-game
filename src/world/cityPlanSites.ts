/**
 * Regions whose Downtown county (County 6) is an authored city, with the city's real
 * [longitude, latitude]. The atlas build (`scripts/build-atlas-data.mjs`) seeds County 6 there, the
 * way County 7 is seeded at the capitol. Keep this module free of imports: the build script loads
 * it directly. Every key needs a plan in `cityPlans/`.
 */
export const CITY_SITES: Readonly<Record<string, readonly [lon: number, lat: number]>> = {
  'US-IL': [-87.6298, 41.8781],
  'US-NV': [-115.14, 36.17],
  'US-NY': [-74.006, 40.7128],
};
