export type SessionKind = "challenge" | "sandbox";
export type DistrictId = "classic" | "d10" | "d30" | "d100";
export type PlayMode = "play" | "pause" | "upgrade" | "results";

export const DISTRICT_COUNTS: Record<DistrictId, number> = {
  classic: 7,
  d10: 10,
  d30: 30,
  d100: 100,
};

export const DEFAULT_DISTRICT_SEEDS: Record<DistrictId, number> = {
  classic: 0x0ddba11,
  d10: 0x10d15c7,
  d30: 0x30d15c7,
  d100: 0x100d15c,
};

export const DISTRICT_LABELS: Record<DistrictId, string> = {
  classic: "LOT 7",
  d10: "10",
  d30: "30",
  d100: "100",
};

export interface SessionRules {
  kind: SessionKind;
  district: DistrictId;
  seed: number;
}

function defaultSessionRules(): SessionRules {
  return {
    kind: "challenge",
    district: "classic",
    seed: DEFAULT_DISTRICT_SEEDS.classic,
  };
}

export function parseSessionFromSearch(search: string): SessionRules {
  const rules = defaultSessionRules();
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("sandbox") === "1" || params.get("mode") === "sandbox") rules.kind = "sandbox";
  const district = params.get("district");
  if (district === "classic" || district === "d10" || district === "d30" || district === "d100") {
    rules.district = district;
    rules.seed = DEFAULT_DISTRICT_SEEDS[district];
  }
  const rawSeed = params.get("seed");
  if (rawSeed !== null && rawSeed !== "") {
    const seed = Number(rawSeed);
    if (Number.isFinite(seed) && seed >= 0) rules.seed = seed >>> 0;
  }
  return rules;
}

export function nextSeed(seed: number): number {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

export function sessionFailsOn(rules: SessionRules): { heat: boolean; track: boolean; clock: boolean } {
  if (rules.kind === "sandbox") return { heat: false, track: false, clock: false };
  return { heat: true, track: true, clock: true };
}

export function sessionForcesUpgrade(rules: SessionRules): boolean {
  return rules.kind === "challenge";
}

