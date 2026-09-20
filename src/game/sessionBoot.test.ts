import { describe, expect, it } from "vitest";
import { CAMPAIGN_LEVELS } from "./campaign";
import { DEFAULT_DISTRICT_SEEDS, parseSessionFromSearch, type PlayMode } from "./session";
import { bootOpenedSession, type SessionBootHost } from "./sessionBoot";
import type { CampaignRun } from "./campaignRun";

function host(search: string): SessionBootHost & {
  campaign: CampaignRun | null;
  mode: PlayMode;
  debug: boolean;
  resetKind: "same" | "new" | null;
} {
  const state = {
    rules: parseSessionFromSearch(search),
    campaign: null as CampaignRun | null,
    mode: "play" as PlayMode,
    debug: false,
    resetKind: null as "same" | "new" | null,
    applyCampaign(run: CampaignRun | null) { state.campaign = run; },
    applyMode(mode: PlayMode) { state.mode = mode; },
    openDebug() { state.debug = true; },
    reset(kind: "same" | "new") { state.resetKind = kind; },
  };
  return state;
}

describe("session boot", () => {
  it("opens the title on a normal visit and still resets the lot", () => {
    const session = host("");
    bootOpenedSession(session, "");
    expect(session.mode).toBe("title");
    expect(session.campaign).toBeNull();
    expect(session.debug).toBe(false);
    expect(session.resetKind).toBe("same");
  });

  it("starts Time Challenge on the requested campaign level", () => {
    const search = "?mode=challenge&seed=19&level=city-downtown";
    const session = host(search);
    bootOpenedSession(session, search);
    expect(session.campaign).not.toBeNull();
    expect(session.campaign?.levelSeed).toBe(19);
    expect(session.campaign?.levelIndex).toBe(CAMPAIGN_LEVELS.findIndex((level) => level.id === "city-downtown"));
    expect(session.campaign?.briefing).toBe(false);
    expect(session.mode).toBe("play");
    expect(session.resetKind).toBe("same");
  });

  it("opens debug for the test yard without a campaign", () => {
    const search = "?yard=1";
    const session = host(search);
    expect(session.rules.seed).toBe(DEFAULT_DISTRICT_SEEDS.classic);
    bootOpenedSession(session, search);
    expect(session.debug).toBe(true);
    expect(session.campaign).toBeNull();
    expect(session.mode).toBe("play");
  });
});
