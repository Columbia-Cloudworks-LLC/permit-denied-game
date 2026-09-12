export type SessionKind = "challenge" | "sandbox";
export type DemoAsset = "ranch" | "rivertown" | "steel-warehouse";
export type DistrictId = "classic" | "d10" | "d30" | "d100";
export type PlayMode = "title" | "play" | "pause" | "upgrade" | "results";

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
  towerTest?: boolean;
  job?: boolean;
  demo?: DemoAsset;
  kind: SessionKind;
  district: DistrictId;
  seed: number;
  ranchFocus: boolean;
}

function defaultSessionRules(): SessionRules {
  return {
    kind: "challenge",
    district: "classic",
    seed: DEFAULT_DISTRICT_SEEDS.classic,
    ranchFocus: false,
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
  if (params.get("ranch") === "1") {
    rules.kind = "sandbox";
    rules.ranchFocus = true;
    if (district !== "classic" && district !== "d10" && district !== "d30" && district !== "d100") {
      rules.district = "d10";
      rules.seed = DEFAULT_DISTRICT_SEEDS.d10;
    }
  }
  const rawSeed = params.get("seed");
  const demo = params.get("demo");
  if (demo === "ranch" || demo === "rivertown" || demo === "steel-warehouse") {
    rules.demo = demo;
    rules.kind = "sandbox";
    rules.district = "classic";
    rules.seed = DEFAULT_DISTRICT_SEEDS.classic;
  }
  if (rawSeed !== null && rawSeed !== "") {
    const seed = Number(rawSeed);
    if (Number.isFinite(seed) && seed >= 0) rules.seed = seed >>> 0;
  }
  if (params.get("tower") === "1") { rules.towerTest = true; rules.kind = "sandbox"; rules.district = "classic"; rules.demo = undefined; rules.ranchFocus = false; }
  if (params.get("job") === "brick") {
    rules.towerTest = false;
    rules.job = true;
    rules.demo = "rivertown";
    rules.kind = "challenge";
    rules.district = "classic";
  }
  return rules;
}

export function nextSeed(seed: number): number {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

export function sessionFailsOn(rules: SessionRules): { heat: boolean; track: boolean; clock: boolean } {
  if (rules.kind === "sandbox" || rules.job) return { heat: false, track: false, clock: false };
  return { heat: true, track: true, clock: true };
}

export function sessionForcesUpgrade(rules: SessionRules): boolean {
  return rules.kind === "challenge" && !rules.job;
}

export function canPickUpgrade(rules: SessionRules, mode: PlayMode, earned: boolean): boolean {
  return rules.kind === "sandbox" || (mode === "upgrade" && earned);
}


/** Explicit scenario links retain their immediate-play behavior. */
export function startsAtTitle(search: string): boolean {
  const params = new URLSearchParams(search);
  return !['sandbox', 'mode', 'district', 'seed', 'ranch', 'demo', 'tower', 'job', 'perf', 'nhood'].some(key => params.has(key));
}
