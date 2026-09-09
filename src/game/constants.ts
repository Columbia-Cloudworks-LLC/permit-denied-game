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
  accel: 14.8,
  reverseAccel: 11.2,
  maxSpeed: 8.6,
  maxReverse: 4.6,
  coast: 3.4,
  lateralGrip: 18,
  steer: 2.85,
  steerSpeedFalloff: 0.2,
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

export const DEBRIS = {
  remnantCap: 96,
  fragmentCap: 140,
  cosmeticCap: 420,
  activeCap: 72,
  solverIters: 5,
  rest: 0.04,
  slop: 0.012,
  baumgarte: 0.32,
  maxCorrect: 0.065,
  gravity: 22,
  sleepSpeed: 0.12,
  sleepOmega: 0.22,
  sleepTime: 0.28,
  wakeImpulse: 0.09,
  maxPushSlow: 0.72,
  scrapeDust: 0.16,
} as const;

export const ROAD = {
  mass: 1.35,
  radius: 0.7,
  length: 1.72,
  width: 0.82,
  accel: 9.2,
  maxSpeed: 7.1,
  coast: 4.2,
  steer: 2.2,
  lateralGrip: 14,
  pushForce: 2.4,
  traction: 0.5,
  clearance: 0.13,
  resistanceMul: 2.55,
  spawnX: 3.4,
  spawnY: 17.6,
  spawnHeading: 0,
} as const;

export const COPY = {
  bladeUp: "BLADE UP",
  bladeDown: "BLADE DOWN",
  engineCooked: "ENGINE COOKED",
  trackThrown: "TRACK THROWN",
  countyClock: "COUNTY CLOCK",
} as const;
