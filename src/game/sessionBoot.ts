import { CAMPAIGN_LEVELS, isCampaignLevelId } from "./campaign";
import { startCampaign, type CampaignRun } from "./campaignRun";
import { startsAtTitle, type PlayMode, type SessionRules } from "./session";

/** Session fields Game.start() boots before the ticker. */
export interface SessionBootHost {
  rules: SessionRules;
  applyCampaign(run: CampaignRun | null): void;
  applyMode(mode: PlayMode): void;
  openDebug(): void;
  reset(kind: "same" | "new"): void;
}

/** Apply URL session rules, campaign start, and title vs immediate-play. */
export function bootOpenedSession(host: SessionBootHost, search: string): void {
  const campaign = host.rules.kind === "challenge" && !host.rules.job ? openCampaign(host.rules, search) : null;
  host.applyCampaign(campaign);
  host.reset("same");
  if (host.rules.testMap) host.openDebug();
  if (startsAtTitle(search)) host.applyMode("title");
}

/**
 * A challenge link starts a campaign at its level; a level named in the link skips the briefing.
 * The link's season and biome override the campaign's, and the rules then follow the campaign.
 */
function openCampaign(rules: SessionRules, search: string): CampaignRun {
  const campaign = startCampaign(rules.seed);
  const levelParam = new URLSearchParams(search).get("level");
  const linked = !!levelParam && isCampaignLevelId(levelParam);
  const requested = linked ? levelParam : rules.level;
  if (requested) {
    campaign.levelIndex = CAMPAIGN_LEVELS.findIndex((level) => level.id === requested);
    if (linked) campaign.briefing = false;
  }
  if (rules.seasonExplicit) campaign.season = rules.season;
  if (rules.biomeId) campaign.biomeId = rules.biomeId;
  rules.season = campaign.season;
  rules.biomeId = campaign.biomeId;
  return campaign;
}
