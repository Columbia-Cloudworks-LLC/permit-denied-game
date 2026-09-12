export interface Upgrades {
  blade: number;
  engine: number;
  push: number;
}

export const UPGRADE_INCREMENTS = { blade: 0.42, engine: 0.28, push: 0.35 } as const;
export interface UpgradeModifiers { bladeMul: number; engineMul: number; pushMul: number }

export function upgradeModifiers(upgrades: Upgrades): UpgradeModifiers {
  return {
    bladeMul: 1 + upgrades.blade * UPGRADE_INCREMENTS.blade,
    engineMul: 1 + upgrades.engine * UPGRADE_INCREMENTS.engine,
    pushMul: 1 + upgrades.push * UPGRADE_INCREMENTS.push,
  };
}

export function upgradePercent(key: keyof Upgrades): string {
  return `+${Math.round(UPGRADE_INCREMENTS[key] * 100)}%`;
}
