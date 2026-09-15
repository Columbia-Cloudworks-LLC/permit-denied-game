/** Campaign urban-band tags. Independent from Sandbox zone weights. */
export const URBAN_BANDS = [
  'rural',
  'village-main-street',
  'suburban',
  'borough-mixed',
  'downtown-core',
  'downtown-transition',
  'service-industrial',
  'estate',
] as const;

export type UrbanBand = (typeof URBAN_BANDS)[number];

export function isUrbanBand(value: string): value is UrbanBand {
  return (URBAN_BANDS as readonly string[]).includes(value);
}

/** Map-position roles. Derived from world-space geometry, not placement-loop index. */
export const DISTRICT_ROLES = [
  'rural',
  'scattered',
  'village-main-street',
  'village-edge',
  'civic-center',
  'mixed-neighborhood',
  'township-edge',
  'suburb-neighborhood',
  'commercial-corridor',
  'suburb-edge',
  'borough-center',
  'mixed-use-corridor',
  'borough-neighborhood',
  'downtown-core',
  'transition-ring',
  'borough-edge',
  'industrial-service-edge',
  'estate',
  'plaza',
  'park',
  'civic-square',
] as const;

export type DistrictRole = (typeof DISTRICT_ROLES)[number];

export function isDistrictRole(value: string): value is DistrictRole {
  return (DISTRICT_ROLES as readonly string[]).includes(value);
}

export const STREET_ROLES = ['standard', 'corner', 'run'] as const;
export type StreetRole = (typeof STREET_ROLES)[number];

export function isStreetRole(value: string): value is StreetRole {
  return (STREET_ROLES as readonly string[]).includes(value);
}

export const ROLE_BANDS: Record<DistrictRole, readonly UrbanBand[]> = {
  rural: ['rural'],
  scattered: ['rural'],
  'village-main-street': ['village-main-street'],
  'village-edge': ['suburban', 'rural'],
  'civic-center': ['village-main-street', 'suburban'],
  'mixed-neighborhood': ['suburban', 'village-main-street'],
  'township-edge': ['suburban', 'rural', 'service-industrial'],
  'suburb-neighborhood': ['suburban'],
  'commercial-corridor': ['suburban', 'village-main-street'],
  'suburb-edge': ['suburban', 'service-industrial'],
  'borough-center': ['borough-mixed', 'downtown-transition'],
  'mixed-use-corridor': ['borough-mixed'],
  'borough-neighborhood': ['borough-mixed'],
  'downtown-core': ['downtown-core'],
  'transition-ring': ['downtown-transition', 'borough-mixed'],
  'borough-edge': ['borough-mixed', 'downtown-transition'],
  'industrial-service-edge': ['service-industrial'],
  estate: ['estate'],
  plaza: ['downtown-core', 'downtown-transition', 'borough-mixed'],
  park: ['borough-mixed', 'suburban'],
  'civic-square': ['downtown-core', 'borough-mixed', 'village-main-street'],
};

export const CITY_DENSE_BANDS: readonly UrbanBand[] = ['downtown-core', 'downtown-transition', 'borough-mixed'];
export const CITY_SERVICE_BANDS: readonly UrbanBand[] = ['service-industrial'];
export const LOW_RISE_PROHIBITED_BANDS: readonly UrbanBand[] = ['downtown-core'];
export const RURAL_SUBURBAN_BANDS: readonly UrbanBand[] = ['rural', 'village-main-street', 'suburban'];
