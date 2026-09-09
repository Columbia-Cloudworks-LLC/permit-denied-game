export const TITLE = "PERMIT DENIED";
export const TAGLINE = "The County Said No.";

export const SIM_DT = 1 / 60;
export const SIM_MAX_STEPS = 5;

export const CELL = 1.15;
export const FLOOR_Z = 2.35;

export const ISO_W = 22;
export const ISO_H = 11;
export const ISO_Z = 14;

export const MATCH_SECONDS = 180;
export const CASH_TARGET = 1800;
export const UPGRADE_MILESTONES = [350, 900, 1600] as const;

export const DOZER = {
  mass: 8.5,
  radius: 0.92,
  length: 2.35,
  width: 1.55,
  accel: 13.5,
  reverseAccel: 9.5,
  maxSpeed: 9.2,
  maxReverse: 4.2,
  coast: 2.8,
  lateralGrip: 14,
  steer: 2.35,
  steerSpeedFalloff: 0.55,
  impactLoss: 0.62,
  grindBody: 4,
  bladeReach: 1.42,
  bladeHalf: 1.08,
  bladeDepth: 0.38,
  grindDps: 22,
  ramScale: 7.4,
  pushForce: 18,
  pushSeconds: 0.72,
  pushCooldown: 2.15,
  pushGrind: 2.4,
  heatGrind: 16,
  heatImpact: 3.2,
  heatCool: 6.2,
  trackImpact: 8,
  trackPole: 34,
  trackCool: 9,
};

export const PARTICLE_CAP = 420;
export const RUBBLE_CAP = 180;

export const COPY = {
  bladeUp: "BLADE UP",
  bladeDown: "BLADE DOWN",
  engineCooked: "ENGINE COOKED",
  trackThrown: "TRACK THROWN",
  countyClock: "COUNTY CLOCK",
} as const;
