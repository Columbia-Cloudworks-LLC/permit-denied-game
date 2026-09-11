/** Gameplay material defaults; appearance finishes are separate from physical composition. */
export const MATERIALS = {
  wood: { hp: 26, beamSpan: 1, density: .55, crushability: .82, friction: .52 },
  brick: { hp: 40, beamSpan: 2, density: 1.05, crushability: .55, friction: .7 },
  concrete: { hp: 62, beamSpan: 2, density: 1.35, crushability: .26, friction: .74 },
  metal: { hp: 54, beamSpan: 2, density: 1.15, crushability: .16, friction: .42 },
  glass: { hp: 9, beamSpan: 0, density: .32, crushability: .96, friction: .22 },
} as const;
export type Material = keyof typeof MATERIALS;
