import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RANCH_LEVER_DIR, runRanchLever } from "./ranchLever";

describe("ranch demolition lever", () => {
  it("stages every phase, writes artifacts, and judges the screenshot state", () => {
    const report = runRanchLever();
    expect(existsSync(join(RANCH_LEVER_DIR, "index.html"))).toBe(true);
    expect(existsSync(join(RANCH_LEVER_DIR, "report.json"))).toBe(true);
    const ids = report.phases.map((p) => p.id);
    expect(ids).toEqual([
      "intact",
      "first-south-breach",
      "mid-collapse-a",
      "mid-collapse-b",
      "mid-collapse-c",
      "south-middle-open",
      "half-destroyed",
      "near-total",
      "reset",
    ]);
    const shot = report.phases.find((p) => p.id === "south-middle-open");
    expect(shot).toBeDefined();
    expect(shot!.metrics.holeColumns).toEqual(expect.arrayContaining([1, 2, 3]));
    const html = readFileSync(join(RANCH_LEVER_DIR, "index.html"), "utf8");
    expect(html).toContain("south-middle open");
    expect(html).toContain("Diagnostic illustration");
    expect(html).toContain("not a PixiJS gameplay capture");
    expect(report.ok, report.failed.map((f) => `${f.phase}:${f.check} ${f.detail}`).join(" | ")).toBe(true);
  });
});
