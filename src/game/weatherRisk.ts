import { climateHazard, defaultClimate, type ClimateEnvelope, type HazardId } from "../world/climate";
import { groundState } from "../world/groundCondition";
import type { SeasonId, WeatherConditionId } from "../world/season";

/** Time Challenge weather stakes. Sandbox, the yard and test maps never apply them. */
export interface WeatherRisk {
  /** Share of lateral grip lost off the pavement. */
  slip: number;
  /** Extra track stress while crossing rubble, as a share of the step's gain. */
  track: number;
  /** Extra engine heat under load, as a share of the step's gain. */
  heat: number;
  /** Hazard Pay: bonus share of settled run escrow. */
  hazardPay: number;
}

type HazardStakes = Omit<WeatherRisk, "slip">;

/**
 * Stakes of each climate hazard. Dust clogs the air filter (heat) and grits the running gear
 * (track); a monsoon or squall pounds the tracks on washed-out ground; extreme heat cooks the
 * engine well past a clear summer day's 8%. A blizzard is priced as the winter storm it is.
 */
const HAZARD_STAKES: Readonly<Record<HazardId, HazardStakes>> = {
  haboob: { track: 0.08, heat: 0.1, hazardPay: 0.2 },
  "blowing-dust": { track: 0.04, heat: 0.05, hazardPay: 0.1 },
  monsoon: { track: 0.12, heat: 0, hazardPay: 0.25 },
  squall: { track: 0.12, heat: 0, hazardPay: 0.2 },
  heat: { track: 0, heat: 0.24, hazardPay: 0.15 },
  blizzard: { track: 0.12, heat: 0, hazardPay: 0.2 },
};

/**
 * Pure rules over the run's season, county sky and climate zone, so the fixed step replays.
 * Traction comes from `groundState`; a map without a climate prices the temperate table.
 */
export function weatherRisk(season: SeasonId, condition: WeatherConditionId | undefined, climate: ClimateEnvelope = defaultClimate()): WeatherRisk {
  const { slip } = groundState(season, condition, climate);
  const hazard = climateHazard(climate, season, condition);
  if (hazard) return { slip, ...HAZARD_STAKES[hazard] };
  const storm = condition === "storm", wet = storm || condition === "precip";
  return {
    slip,
    track: storm ? 0.12 : 0,
    heat: condition === "clear" && season === "summer" ? 0.08 : 0,
    hazardPay: storm ? 0.2 : wet || condition === "fog" ? 0.1 : 0,
  };
}

/** `+20% HAZARD PAY`, or nothing when the weather pays baseline. */
export function hazardPayLabel(risk: Pick<WeatherRisk, "hazardPay">): string {
  return risk.hazardPay ? `+${Math.round(risk.hazardPay * 100)}% HAZARD PAY` : "";
}
