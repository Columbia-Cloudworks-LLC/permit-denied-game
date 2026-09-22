import { describe, expect, it } from "vitest";
import { PAL } from "./palette";
import {
  COVER_KINDS,
  HARD_LOT_COVERS,
  SOFT_LOT_COVERS,
  coverColor,
  coverDark,
} from "./coverPalette";

function luminance(color: number): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function channels(color: number): { r: number; g: number; b: number } {
  return { r: (color >> 16) & 255, g: (color >> 8) & 255, b: color & 255 };
}

describe("cover palettes", () => {
  it("covers every CoverKind for both map conditions", () => {
    expect(COVER_KINDS).toHaveLength(16);
    for (const cover of COVER_KINDS) {
      expect(coverColor(cover, "clear")).toEqual(expect.any(Number));
      expect(coverColor(cover, "snow")).toEqual(expect.any(Number));
      expect(coverDark(cover, "clear")).toEqual(expect.any(Number));
      expect(coverDark(cover, "snow")).toEqual(expect.any(Number));
    }
  });

  it("keeps the clear palette on non-snow maps", () => {
    expect(coverColor("grass", "clear")).toBe(PAL.grass);
    expect(coverColor("dirt", "clear")).toBe(PAL.dirt);
    expect(coverColor("planted", "clear")).toBe(PAL.planted);
    expect(coverColor("lot", "clear")).toBe(PAL.lot);
    expect(coverColor("driveway", "clear")).toBe(0x5a5248);
    expect(coverColor("water", "clear")).toBe(PAL.water);
    expect(coverColor("water", "snow")).not.toBe(PAL.water);
    expect(coverColor("water", "snow")).toBe(0x6e8ea4);
  });

  it("snows soft lot covers without summer-green or warm-earth rectangles", () => {
    for (const cover of SOFT_LOT_COVERS) {
      const snow = coverColor(cover, "snow");
      const clear = coverColor(cover, "clear");
      expect(snow).not.toBe(clear);
      expect(luminance(snow)).toBeGreaterThan(luminance(clear));
      const { r, g, b } = channels(snow);
      expect(g - r, `${cover} must not stay summer-green`).toBeLessThan(24);
      expect(r).toBeGreaterThan(140);
      expect(b).toBeGreaterThan(140);
    }
  });

  it("winterizes hard covers while keeping them darker than snow lawns", () => {
    const snowGrass = coverColor("grass", "snow");
    for (const cover of HARD_LOT_COVERS) {
      const snow = coverColor(cover, "snow");
      expect(snow).not.toBe(coverColor(cover, "clear"));
      expect(snow).not.toBe(snowGrass);
      expect(luminance(snow)).toBeLessThan(luminance(snowGrass) - 12);
    }
    expect(coverColor("driveway", "snow")).not.toBe(coverColor("parking", "snow"));
    expect(coverColor("tracks", "snow")).not.toBe(snowGrass);
  });
});
