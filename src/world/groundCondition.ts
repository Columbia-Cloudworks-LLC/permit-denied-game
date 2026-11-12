import { climateHazard, defaultClimate, lookSeason, snowOnGround, waterFrozen, type ClimateEnvelope, type SoilProfile } from "./climate";
import type { SeasonId, WeatherConditionId } from "./season";

/** Map-level ground cover. Shared by terrain tiles, lot covers, roofs and trees; never rolled per lot. */
export type GroundCondition = "clear" | "snow";

/** The four season fields of a `Town`. They only ever come from here, so they cannot disagree. */
export interface TownSeasonState {
  /** Calendar season: weather odds, field states, labels. */
  season: SeasonId;
  /** The season to paint in: a snowless winter borrows its zone's `winterLook`. */
  look: SeasonId;
  /** Ponds and rivers are ice the dozer can cross. */
  frozen: boolean;
  groundCondition: GroundCondition;
}

/** A map without a climate keeps the legacy snowy, frozen winter. */
export function townSeasonState(season: SeasonId, climate: Pick<ClimateEnvelope, "allowsSnow" | "allowsFreeze" | "winterLook"> = defaultClimate()): TownSeasonState {
  return {
    season,
    look: lookSeason(season, climate),
    frozen: waterFrozen(season, climate),
    groundCondition: snowOnGround(season, climate) ? "snow" : "clear",
  };
}

/** What the tracks meet off the pavement. `mud-wash` is monsoon runoff over caliche. */
export type Footing = "dry" | "wet" | "mud-wash" | "snow";

export interface GroundState {
  cover: GroundCondition;
  footing: Footing;
  /** Share of lateral grip lost off the pavement. The only source of weather traction. */
  slip: number;
}

const RAIN_SLIP = 0.09;
const STORM_SLIP = 0.15;
const SQUALL_SLIP = 0.18;
const MUD_WASH_SLIP = 0.24;

/**
 * Ground under a county sky. Snow footing needs snow cover, so a zone that cannot snow never
 * reports it; its winter rain is plain wet ground. Falling snow slips like the rain it replaces.
 */
export function groundState(season: SeasonId, condition: WeatherConditionId | undefined, climate: ClimateEnvelope = defaultClimate()): GroundState {
  const cover: GroundCondition = snowOnGround(season, climate) ? "snow" : "clear";
  const hazard = climateHazard(climate, season, condition);
  if (hazard === "monsoon") return { cover, footing: "mud-wash", slip: MUD_WASH_SLIP };
  if (hazard === "squall") return { cover, footing: "wet", slip: SQUALL_SLIP };
  const slip = condition === "storm" ? STORM_SLIP : condition === "precip" ? RAIN_SLIP : 0;
  return { cover, footing: cover === "snow" ? "snow" : slip ? "wet" : "dry", slip };
}

const SNOW_TRACK = 0xb7c3cc;

/** A tread impression: packed snow, churned mud when wet, else the soil's own compacted colour. */
export function trackColor(footing: Footing, soil: SoilProfile): number {
  if (footing === "snow") return SNOW_TRACK;
  return footing === "dry" ? soil.track : soil.mud;
}
