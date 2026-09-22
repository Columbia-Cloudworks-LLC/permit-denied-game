import { describe, expect, it } from "vitest";
import { CAMPAIGN_LEVELS, campaignLevelById } from "./campaign";
import { startCampaign } from "./campaignRun";
import { debugMapLabel, debugSessionFacts, debugSessionPanels } from "./debugSession";
import { parseSessionFromSearch } from "./session";
import { generationLevel, rulesForTestMap, showCampaignHud } from "./sessionTransition";
import { createTown } from "../world/town";

describe("mode transitions", () => {
  it("clears campaign objectives when entering the asset yard from any challenge level", () => {
    for (const level of CAMPAIGN_LEVELS) {
      const run = startCampaign(77);
      run.levelIndex = level.index - 1;
      const rules = rulesForTestMap(77, { kind: "yard" });
      expect(showCampaignHud(rules, run)).toBe(false);
      expect(generationLevel(rules, run)).toBeUndefined();
    }
    const sandbox = parseSessionFromSearch("?mode=sandbox&district=d30&seed=19");
    expect(showCampaignHud(sandbox, startCampaign(19))).toBe(false);
  });

  it("describes the active challenge level instead of a sandbox size or brick objective", () => {
    const view = {
      session: "challenge" as const,
      district: "d100" as const,
      levelId: "county" as const,
      levelIndex: 1,
      levelName: "County",
      seed: 77,
      buildingCount: 12,
      landmarkName: "County Sheriff's Office",
      dollarTarget: 4200,
      timeLimit: 180,
    };
    expect(debugMapLabel(view)).toBe("Time Challenge · 1/7 County");
    expect(debugSessionPanels(view)).toEqual({ levels: true, job: false, upgrades: false });
    expect(debugSessionFacts(view)).toContain("12 buildings");
    expect(debugSessionFacts(view)).toContain("seed 77");
    expect(debugSessionFacts(view)).toContain("$4,200");
    expect(debugSessionFacts(view)).toContain("180s county clock");
    expect(debugSessionFacts(view)).not.toContain("No time limit");
    expect(debugMapLabel({ ...view, testMapName: "All Assets Sandbox" })).toBe("All Assets Sandbox");
    expect(debugSessionPanels({ ...view, testMapName: "All Assets Sandbox" })).toEqual({
      levels: false,
      job: false,
      upgrades: false,
    });
  });

  it("uses one campaign level for sandbox and time challenge generation", () => {
    for (const level of CAMPAIGN_LEVELS) {
      for (const seed of [19, 77]) {
        const sandboxRules = parseSessionFromSearch(`?mode=sandbox&level=${level.id}&seed=${seed}`);
        const challenge = startCampaign(seed);
        challenge.levelIndex = level.index - 1;
        const challengeRules = parseSessionFromSearch(`?mode=challenge&level=${level.id}&seed=${seed}`);
        expect(generationLevel(sandboxRules, null)?.id).toBe(level.id);
        expect(generationLevel(challengeRules, challenge)?.id).toBe(level.id);
        expect(showCampaignHud(sandboxRules, null)).toBe(false);
        expect(showCampaignHud(challengeRules, challenge)).toBe(true);
        const map = createTown({ district: "d30", seed, campaign: campaignLevelById(level.id) });
        const again = createTown({ district: "d30", seed, campaign: generationLevel(sandboxRules, null) });
        expect(again.buildings.map((building) => [building.archetypeId, building.x, building.y])).toEqual(
          map.buildings.map((building) => [building.archetypeId, building.x, building.y]),
        );
        expect(map.lots.length).toBeGreaterThan(0);
      }
    }
  });
});
