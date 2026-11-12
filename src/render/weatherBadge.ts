import { climateHazard, defaultClimate, snowOnGround, type ClimateEnvelope, type HazardId } from "../world/climate";
import { weatherConditionLabel, type SeasonId, type WeatherConditionId } from "../world/season";
import type { WeatherIconId } from "./menuIcons";

/**
 * How one county sky reads in the UI. Map tooltips, the county bar, briefings and the HUD all
 * take their label, glyph and warning from here, so a snowless county can never show a
 * snowflake or an ice warning in one place and rain in another.
 */
export interface WeatherBadge {
  label: string;
  icon: WeatherIconId;
  hazard?: HazardId;
  /** HUD advisory while the hazard is active. */
  advisory?: string;
}

const HAZARD_BADGES: Readonly<Record<HazardId, { icon: WeatherIconId; advisory: string }>> = {
  haboob: { icon: "dust", advisory: "HABOOB · LOW VISIBILITY" },
  "blowing-dust": { icon: "dust", advisory: "BLOWING DUST · WATCH THE AIR FILTER" },
  monsoon: { icon: "monsoon", advisory: "MONSOON · SLICK WASH OFF THE PAVEMENT" },
  squall: { icon: "squall", advisory: "SQUALL · SLICK GROUND" },
  heat: { icon: "heat", advisory: "EXTREME HEAT · EASE OFF THE LOAD" },
  blizzard: { icon: "blizzard", advisory: "BLIZZARD · SLICK GROUND" },
};

export function weatherBadge(season: SeasonId, condition: WeatherConditionId, climate: ClimateEnvelope = defaultClimate()): WeatherBadge {
  const label = weatherConditionLabel(season, condition, climate);
  const hazard = climateHazard(climate, season, condition);
  if (hazard) return { label, hazard, ...HAZARD_BADGES[hazard] };
  return { label, icon: skyIcon(condition, snowOnGround(season, climate)) };
}

function skyIcon(condition: WeatherConditionId, snow: boolean): WeatherIconId {
  switch (condition) {
    case "clear":
      return "sun";
    case "overcast":
      return "cloud";
    case "precip":
      return snow ? "snow" : "rain";
    case "storm":
      return "storm";
    case "fog":
      return "fog";
    case "dust":
      return "dust";
    case "heat":
      return "heat";
    default: {
      const _never: never = condition;
      return _never;
    }
  }
}
