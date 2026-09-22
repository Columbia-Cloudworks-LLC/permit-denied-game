import { describe, expect, it } from "vitest";
import { BIOME_IDS, BIOME_PROFILES } from "./biomes";
import { mapGroundCondition } from "./groundCondition";
import { createTown } from "./town";

describe("map ground condition", () => {
  it("is snow only for northern-conifer", () => {
    expect(mapGroundCondition("northern-conifer")).toBe("snow");
    expect(mapGroundCondition(BIOME_PROFILES["northern-conifer"])).toBe("snow");
    expect(mapGroundCondition("temperate-broadleaf")).toBe("clear");
    expect(mapGroundCondition("mixed-woodland")).toBe("clear");
    expect(mapGroundCondition("agricultural-plain")).toBe("clear");
    for (const id of BIOME_IDS) {
      expect(mapGroundCondition(id)).toBe(id === "northern-conifer" ? "snow" : "clear");
    }
  });

  it("keeps conifer maps clear unless the season is winter", () => {
    const classic = createTown();
    expect(classic.groundCondition).toBe("clear");
    expect(classic.season).toBe("summer");

    const conifer = createTown({ district: "d10", seed: 1, topology: "tjunction" });
    expect(conifer.biome.id).toBe("northern-conifer");
    expect(conifer.groundCondition).toBe("clear");

    const snow = createTown({ district: "d10", seed: 1, topology: "tjunction", season: "winter" });
    expect(snow.biome.id).toBe("northern-conifer");
    expect(snow.groundCondition).toBe("snow");
    expect(snow.season).toBe("winter");

    const clear = createTown({ district: "d10", seed: 19, topology: "curve-farm" });
    expect(clear.biome.id).not.toBe("northern-conifer");
    expect(clear.groundCondition).toBe("clear");
  });
});
