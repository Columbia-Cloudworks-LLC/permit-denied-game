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

export function weatherRisk(season: SeasonId, condition: WeatherConditionId | undefined): WeatherRisk {
  const storm = condition === "storm", wet = storm || condition === "precip";
  return {
    slip: storm ? 0.15 : wet ? 0.09 : 0,
    track: storm ? 0.12 : 0,
    heat: condition === "clear" && season === "summer" ? 0.08 : 0,
    hazardPay: storm ? 0.2 : wet || condition === "fog" ? 0.1 : 0,
  };
}

/** `+20% HAZARD PAY`, or nothing when the weather pays baseline. */
export function hazardPayLabel(risk: Pick<WeatherRisk, "hazardPay">): string {
  return risk.hazardPay ? `+${Math.round(risk.hazardPay * 100)}% HAZARD PAY` : "";
}
