import { Graphics } from "pixi.js";
import type { Prop } from "../structure/types";
import { getAsset } from "../world/catalog";
import type { SeasonId } from "../world/season";
import { drawCar } from "./vehicles";
import { drawOrientedIsoBox, drawShadow, PAL } from "./drawIso";

export function drawCatalogProp(g: Graphics, p: Prop, season: SeasonId = "summer"): void {
  const def = getAsset(p.assetId);
  const z0 = p.elev + p.pose.crush * -0.18;
  const lean = p.pose.lean * 0.35;
  const heading = p.heading + p.pose.roll;
  const cx = p.x + p.w * 0.5 + p.pose.leanX * lean;
  const cy = p.y + p.d * 0.5 + p.pose.leanY * lean;
  drawShadow(g, p.x, p.y, p.w, p.d, 0.2);
  if (def.id === "car") {
    drawCar(g, p);
    return;
  }
  const boxes = def.boxes.length
    ? def.boxes
    : [
        {
          along: 0,
          across: 0,
          z: 0,
          len: p.w,
          wid: p.d,
          h: Math.max(0.4, def.footprint.h * (1 - p.pose.crush * 0.45)),
          top: PAL.metalTop,
          left: PAL.metalDark,
          right: PAL.metal,
        },
      ];
  const tint = 1 - p.variant * 0.04;
  const pine = def.id.startsWith("pine");
  const deciduous = def.id.startsWith("oak") || def.id === "mature-tree" || def.id === "shrub";
  let bareDrawn = false;
  for (const box of boxes) {
    const canopy = box.z > 0.45;
    if (deciduous && season === "winter" && canopy) {
      if (!bareDrawn) {
        drawOrientedIsoBox(g, cx, cy, heading, 0.55, 0.1, 1.15, 0.1, 0x7a4e28, 0x5a3818, 0x6a4424, 1);
        drawOrientedIsoBox(g, cx, cy, heading + 0.8, 0.42, 0.08, 1.35, 0.08, 0x6a4424, 0x4a3018, 0x7a4e28, 1);
        bareDrawn = true;
      }
      continue;
    }
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    const x = cx + fx * box.along - fy * box.across;
    const y = cy + fy * box.along + fx * box.across;
    const h = box.h * (1 - p.pose.crush * 0.4);
    const colors = foliageTint(box.top, box.left, box.right, season, pine, deciduous && canopy);
    drawOrientedIsoBox(
      g,
      x,
      y,
      heading,
      box.len,
      box.wid,
      z0 + box.z,
      Math.max(0.05, h * (season === "spring" && deciduous && canopy ? 0.7 : 1)),
      shade(colors.top, tint),
      shade(colors.left, tint),
      shade(colors.right, tint),
      1,
      'slope' in box && box.slope === true,
    );
  }
  if (pine && season === "winter") {
    drawOrientedIsoBox(g, cx, cy, heading, p.w * 0.35, p.d * 0.35, z0 + 2.2, 0.12, 0xe4eef4, 0xb7c6d0, 0xd0dce6, 1);
  }
}

function foliageTint(top: number, left: number, right: number, season: SeasonId, pine: boolean, canopy: boolean): { top: number; left: number; right: number } {
  if (!canopy || pine) return { top, left, right };
  switch (season) {
    case "spring":
      return { top: 0x8cbc62, left: 0x4e7434, right: 0x6a9448 };
    case "autumn":
      return { top: 0xc45a28, left: 0x7a3018, right: 0xa04420 };
    case "summer":
    case "winter":
      return { top, left, right };
    default: {
      const _never: never = season;
      return _never;
    }
  }
}

function shade(color: number, mul: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * mul));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * mul));
  const b = Math.min(255, Math.round((color & 255) * mul));
  return (r << 16) | (g << 8) | b;
}
