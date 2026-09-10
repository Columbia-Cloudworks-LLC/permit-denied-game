import { Graphics } from "pixi.js";
import type { Prop } from "../structure/types";
import { getAsset } from "../world/catalog";
import { drawCar } from "./vehicles";
import { drawOrientedIsoBox, drawShadow, PAL } from "./drawIso";

export function drawCatalogProp(g: Graphics, p: Prop): void {
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
  for (const box of boxes) {
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    const x = cx + fx * box.along - fy * box.across;
    const y = cy + fy * box.along + fx * box.across;
    const h = box.h * (1 - p.pose.crush * 0.4);
    drawOrientedIsoBox(
      g,
      x,
      y,
      heading,
      box.len,
      box.wid,
      z0 + box.z,
      Math.max(0.05, h),
      shade(box.top, tint),
      shade(box.left, tint),
      shade(box.right, tint),
      1,
    );
  }
}

function shade(color: number, mul: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * mul));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * mul));
  const b = Math.min(255, Math.round((color & 255) * mul));
  return (r << 16) | (g << 8) | b;
}
