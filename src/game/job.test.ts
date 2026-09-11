import { describe, expect, it } from "vitest";
import { createBuildingFromArchetype } from "../structure/building";
import { DemolitionJob } from "./job";
import { canPickUpgrade, parseSessionFromSearch } from "./session";
import { advanceSimulation } from "./fixedStep";
import { cameraFocus } from "./camera";
import { worldToScreen } from "../world/iso";

describe("brick contract", () => {
  it("starts with no progress and leaves sandbox/clock selectable", () => {
    const rules = parseSessionFromSearch("?job=brick");
    expect(rules).toMatchObject({ job: true, kind: "challenge", demo: "rivertown" });
    const job = new DemolitionJob(createBuildingFromArchetype("rivertown", "BRICK", 0, 0));
    expect(job.status().progress).toBe(0);
    expect(job.settle()).toBe(0);
    expect(job.takeChoice()).toBe(false);
  });
  it("pays once at 90%, waits for falls, ignores debris and preserves building bonus ownership", () => {
    const b = createBuildingFromArchetype("rivertown", "BRICK", 0, 0);
    const job = new DemolitionJob(b);
    const count = Math.ceil(job.members.length * .9);
    job.members.slice(0, count - 1).forEach(c => c.state = "gone");
    expect(job.settle()).toBe(0);
    job.members[count - 1]!.state = "gone";
    b.roofs[0]!.state = "falling";
    expect(job.settle()).toBe(0);
    b.roofs[0]!.state = "gone";
    expect(job.settle()).toBe(1200);
    expect(job.settle()).toBe(0);
    expect(b.collapseBonusPaid).toBe(false);
    expect(job.takeChoice()).toBe(true);
    expect(job.takeChoice()).toBe(false);
  });
  it("does not let toolbar/number shortcuts buy unearned challenge upgrades", () => {
    const rules = parseSessionFromSearch("");
    expect(canPickUpgrade(rules, "play", false)).toBe(false);
    expect(canPickUpgrade(rules, "pause", true)).toBe(false);
    expect(canPickUpgrade(rules, "upgrade", false)).toBe(false);
    expect(canPickUpgrade(rules, "upgrade", true)).toBe(true);
    expect(canPickUpgrade(parseSessionFromSearch("?sandbox=1"), "play", false)).toBe(true);
  });
  it.each(["upgrade", "results"])("stops accumulated simulation at %s", destination => {
    let mode = "play", calls = 0;
    const out = advanceSimulation(.05, 1 / 120, 8, () => mode === "play", () => { calls++; mode = destination; });
    expect(calls).toBe(1);
    expect(out.acc).toBe(0);
    expect(out.dropped).toBe(0);
  });
  it.each([.25, .62, 1.15, 1.6])("centers distant world positions at zoom %s", zoom => {
    const p = worldToScreen(125, -72, .4);
    const cam = cameraFocus(125, -72, .4, zoom);
    for (const [w, h] of [[1280, 720], [1920, 1080]]) {
      expect(w! / 2 - cam.x + p.x * zoom).toBeCloseTo(w! / 2);
      expect(h! / 2 - cam.y + p.y * zoom).toBeCloseTo(h! / 2);
    }
  });
});
