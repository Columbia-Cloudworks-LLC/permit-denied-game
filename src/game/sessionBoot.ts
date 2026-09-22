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
  let campaign: CampaignRun | null = null;
  if (host.rules.kind === "challenge" && !host.rules.job) campaign = startCampaign(host.rules.seed);
  const levelParam = new URLSearchParams(search).get("level");
  const requested = levelParam && isCampaignLevelId(levelParam) ? levelParam : host.rules.level;
  if (campaign && requested) {
    campaign.levelIndex = CAMPAIGN_LEVELS.findIndex((level) => level.id === requested);
    if (levelParam && isCampaignLevelId(levelParam)) campaign.briefing = false;
  }
  if (campaign) {
    if (host.rules.seasonExplicit) campaign.season = host.rules.season;
    if (host.rules.biomeId) campaign.biomeId = host.rules.biomeId;
    host.rules.season = campaign.season;
    host.rules.biomeId = campaign.biomeId;
  }
  host.applyCampaign(campaign);
  host.reset("same");
  if (host.rules.testMap) host.openDebug();
  if (startsAtTitle(search)) host.applyMode("title");
}
