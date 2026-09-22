import { campaignLevelById, type CampaignLevelDef, type CampaignLevelId } from "./campaign";
import { currentLevel, type CampaignRun } from "./campaignRun";
import type { SessionRules } from "./session";
import type { TestMapRequest } from "../world/testMapRequest";

/** Yard and asset links are sandbox inspections. They do not keep a campaign run. */
export function rulesForTestMap(seed: number, testMap: TestMapRequest): SessionRules {
  return { kind: "sandbox", district: "classic", seed, ranchFocus: false, testMap };
}

/**
 * Campaign objectives render only for an active Time Challenge.
 * Sandbox, the asset yard, and the brick job never keep countdown targets.
 */
export function showCampaignHud(rules: SessionRules, campaign: CampaignRun | null): boolean {
  return rules.kind === "challenge" && !rules.testMap && !rules.job && !!campaign;
}

/** Shared map generation for Sandbox and Time Challenge. Mode rules stay outside the town. */
export function generationLevel(rules: SessionRules, campaign: CampaignRun | null): CampaignLevelDef | undefined {
  if (rules.testMap || rules.job) return undefined;
  if (campaign && rules.kind === "challenge") return currentLevel(campaign);
  if (rules.level) return campaignLevelById(rules.level);
  return undefined;
}

export function levelIndex(id: CampaignLevelId): number {
  return campaignLevelById(id).index - 1;
}
