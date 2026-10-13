import type { Graphics } from "pixi.js";
import { ISO_W } from "../game/constants";
import { Rng } from "../game/rng";
import type { WeatherFlake } from "../fx/seasonWeather";
import type { Bird, Particle, ParticleKind, Rubble } from "../structure/types";
import type { WeatherKind } from "../world/season";
import { worldToScreen } from "../world/iso";
import { cellColors, drawOrientedIsoBox, PAL } from "./drawIso";
import { shade } from "./palette";

/** Centimetre pose steps stay under a pixel at street zoom, even on 2x displays. */
const poseStep = (v: number) => Math.round(v * 100);

export function debrisVersion(r: Rubble): string {
  return `${poseStep(r.x)}:${poseStep(r.y)}:${poseStep(r.elev)}:${poseStep(r.heading)}:${r.w}:${r.d}:${r.thickness}:${r.damage}`;
}

export function settledParticleVersion(p: Particle): string {
  const fade = Math.min(1, p.life / p.maxLife);
  return `${p.kind}:${poseStep(p.x)}:${poseStep(p.y)}:${poseStep(p.z)}:${poseStep(p.rot)}:${p.size}:${p.tint}:${Math.round(fade * 32)}`;
}

const FLAKE_STYLE: Partial<Record<WeatherKind, { color: number; w: number; d: number }>> = {
  rain: { color: 0x9eb4c4, w: 0.05, d: 0.16 },
  leaves: { color: 0xc47a32, w: 0.12, d: 0.08 },
};
const SNOW_FLAKE = { color: 0xf4f7fb, w: 0.12, d: 0.08 };

export function drawWeatherFlake(g: Graphics, flake: WeatherFlake): void {
  const { color, w, d } = FLAKE_STYLE[flake.kind] ?? SNOW_FLAKE;
  drawOrientedIsoBox(g, flake.x, flake.y, 0.4, w, d, flake.z, 0.04, color, color, color, 0.7);
}

/** Dust this faded is under a tenth of opacity, which overview zoom shrinks to a couple of pixels. */
const SPECK_DUST_FADE = 0.2;

export function particleBelowSpeck(p: Particle): boolean {
  return p.kind === "dust" && p.life / p.maxLife < SPECK_DUST_FADE;
}

/**
 * Overview LOD: the contact shadow is under a pixel and a chip is a speck, so each
 * particle is one fill in its lit face colour at the same screen spot.
 */
export function drawParticleSpeck(g: Graphics, p: Particle): void {
  const fade = Math.min(1, p.life / p.maxLife);
  if (p.kind === "dust") {
    drawDustSpeck(g, p, fade);
    return;
  }
  const c = worldToScreen(p.x, p.y, p.z);
  const { color, len, wid } = particleChip(p);
  const s = (len + wid) * ISO_W * 0.5;
  g.rect(c.x - s / 2, c.y - s / 4, s, s / 2);
  g.fill({ color, alpha: (p.kind === "crop" ? 0.88 : 0.92) * fade });
}

function drawDustSpeck(g: Graphics, p: Particle, fade: number): void {
  const c = worldToScreen(p.x, p.y, p.z);
  const r = 5 + p.size * 10;
  g.rect(c.x - r / 2, c.y - r / 2, r, r);
  g.fill({ color: PAL.dust, alpha: 0.32 * fade });
}

const CHIP_COLORS: Partial<Record<ParticleKind, { color: number; dark: number }>> = {
  wood: { color: PAL.wood, dark: PAL.woodDark },
  brick: { color: PAL.brick, dark: PAL.brickDark },
  metal: { color: PAL.metal, dark: PAL.metalDark },
  glass: { color: 0xa8c4d0, dark: PAL.concreteDark },
};
const CONCRETE_CHIP = { color: PAL.concrete, dark: PAL.concreteDark };

function particleChip(p: Particle): { color: number; dark: number; len: number; wid: number } {
  if (p.kind === "crop") {
    const color = p.tint ?? 0xd4c44a;
    return { color, dark: shade(color, 0.65), len: 0.09 + p.size * 0.18, wid: 0.04 + p.size * 0.06 };
  }
  const { color, dark } = CHIP_COLORS[p.kind] ?? CONCRETE_CHIP;
  // Splinters run long and thin; masonry and metal break into squatter chips.
  const len = p.kind === "wood" ? 0.18 + p.size * 0.35 : 0.1 + p.size * 0.22;
  const wid = p.kind === "wood" ? 0.05 + p.size * 0.08 : 0.07 + p.size * 0.12;
  return { color, dark, len, wid };
}

export function drawParticle(g: Graphics, p: Particle): void {
  const fade = Math.min(1, p.life / p.maxLife);
  const s = worldToScreen(p.x, p.y, 0);
  g.ellipse(s.x, s.y, 3.2, 1.6);
  g.fill({ color: PAL.shadow, alpha: 0.2 * fade });
  if (p.kind === "dust") {
    drawDustSpeck(g, p, fade);
    return;
  }
  const { color, dark, len, wid } = particleChip(p);
  if (p.kind === "crop") {
    drawOrientedIsoBox(g, p.x, p.y, p.rot, len, wid, p.z, Math.max(0.03, p.size * 0.12), color, dark, shade(color, 0.8), 0.88 * fade);
    return;
  }
  drawOrientedIsoBox(g, p.x, p.y, p.rot, len, wid, p.z, Math.max(0.04, p.size * 0.2), color, dark, color, 0.92 * fade);
}

type DebrisColors = ReturnType<typeof cellColors>;

export function drawDebris(g: Graphics, r: Rubble): void {
  const rng = new Rng(r.seed);
  const cols = cellColors(r.material, true);
  const h = Math.max(0.05, r.thickness);
  drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w * 1.08, r.d * 1.08, 0, 0.02, PAL.shadow, PAL.shadow, PAL.shadow, 0.26);
  if (r.skin === "roofing") drawRoofingDebris(g, r, h, rng);
  else if (r.shape === "beam") drawBeamDebris(g, r, h, rng, cols);
  else if (r.shape === "panel") drawPanelDebris(g, r, h, rng, cols);
  else drawChunkDebris(g, r, h, rng, cols);
}

const ROOFING_DEBRIS = {
  metal: { top: PAL.roofMetal, edge: PAL.metalDark, under: PAL.metalDark, underDark: PAL.metal },
  shingle: { top: PAL.roofShingle, edge: PAL.roofShingleDark, under: PAL.wood, underDark: PAL.woodDark },
};

/** A torn roof panel: decking under its covering, and on shingles sometimes a folded flap. */
function drawRoofingDebris(g: Graphics, r: Rubble, h: number, rng: Rng): void {
  const metal = r.material === "metal";
  const { top, edge, under, underDark } = metal ? ROOFING_DEBRIS.metal : ROOFING_DEBRIS.shingle;
  drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w, r.d, r.elev, Math.max(0.04, h * 0.45), under, underDark, under, 0.95);
  drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w * 0.9, r.d * 0.86, r.elev + h * 0.28, Math.max(0.05, h * 0.72), top, edge, edge, 1);
  if (metal || rng.next() <= 0.55) return;
  const fold = rng.range(-0.18, 0.18);
  drawOrientedIsoBox(
    g,
    r.x + Math.cos(r.heading) * r.w * 0.28,
    r.y + Math.sin(r.heading) * r.w * 0.28,
    r.heading + fold,
    r.w * 0.26,
    r.d * 0.2,
    r.elev + h * 0.55,
    h * 0.28,
    PAL.roofShingleDark,
    PAL.woodDark,
    PAL.roofShingle,
    1,
  );
}

function drawBeamDebris(g: Graphics, r: Rubble, h: number, rng: Rng, cols: DebrisColors): void {
  drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w, r.d, r.elev, h, cols.top, cols.left, cols.right, 1);
  if (rng.next() <= 0.4) return;
  const t = rng.range(-0.22, 0.22);
  const fx = Math.cos(r.heading);
  const fy = Math.sin(r.heading);
  drawOrientedIsoBox(
    g,
    r.x + fx * t * r.w,
    r.y + fy * t * r.w,
    r.heading + rng.range(-0.25, 0.25),
    r.w * 0.35,
    r.d * 0.7,
    r.elev + h * 0.15,
    h * 0.45,
    cols.top,
    cols.left,
    cols.right,
    1,
  );
}

function drawPanelDebris(g: Graphics, r: Rubble, h: number, rng: Rng, cols: DebrisColors): void {
  const z0 = r.elev;
  const fold = rng.range(-0.45, 0.45);
  const fx = Math.cos(r.heading);
  const fy = Math.sin(r.heading);
  const rx = -fy;
  const ry = fx;
  drawOrientedIsoBox(g, r.x + rx * r.d * 0.18, r.y + ry * r.d * 0.18, r.heading + fold, r.w * 0.62, r.d * 0.58, z0, h, cols.top, cols.left, cols.right, 1);
  drawOrientedIsoBox(g, r.x - rx * r.d * 0.16, r.y - ry * r.d * 0.16, r.heading - fold * 0.8, r.w * 0.48, r.d * 0.42, z0 + h * 0.2, h * 0.7, cols.top, cols.left, cols.right, 0.95);
  drawOrientedIsoBox(
    g,
    r.x + fx * r.w * 0.22,
    r.y + fy * r.w * 0.22,
    r.heading + fold * 1.2,
    r.w * 0.32,
    r.d * 0.28,
    z0 + h * 0.12,
    h * 0.5,
    cols.top,
    cols.left,
    cols.right,
    0.92,
  );
}

function drawChunkDebris(g: Graphics, r: Rubble, h: number, rng: Rng, cols: DebrisColors): void {
  const z0 = r.elev;
  drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w * rng.range(0.82, 1.05), r.d * rng.range(0.7, 1.02), z0, h, cols.top, cols.left, cols.right, 1);
  if (r.layer === "remnant" && rng.next() > 0.28) {
    const ox = rng.range(-0.22, 0.22);
    const oy = rng.range(-0.22, 0.22);
    drawOrientedIsoBox(
      g,
      r.x + ox,
      r.y + oy,
      r.heading + rng.range(-0.55, 0.55),
      r.w * rng.range(0.32, 0.62),
      r.d * rng.range(0.28, 0.55),
      z0 + h * 0.25,
      h * rng.range(0.28, 0.7),
      cols.top,
      cols.left,
      cols.right,
      1,
    );
  }
  if (rng.next() > 0.45) {
    drawOrientedIsoBox(
      g,
      r.x + rng.range(-0.16, 0.16),
      r.y + rng.range(-0.16, 0.16),
      r.heading + rng.range(-0.8, 0.8),
      r.w * rng.range(0.18, 0.4),
      r.d * rng.range(0.12, 0.3),
      z0 + h * 0.08,
      h * 0.35,
      cols.top,
      cols.left,
      cols.right,
      0.9,
    );
  }
}

export function drawBird(g: Graphics, bird: Bird): void {
  const c = worldToScreen(bird.x, bird.y, bird.z);
  g.poly([c.x, c.y, c.x + 6, c.y - 2, c.x + 2, c.y + 1]);
  g.fill({ color: PAL.bird, alpha: Math.min(1, bird.life) });
}
