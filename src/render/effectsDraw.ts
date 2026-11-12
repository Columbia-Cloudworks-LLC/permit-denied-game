import type { Graphics } from "pixi.js";
import { ISO_W } from "../game/constants";
import { Rng } from "../game/rng";
import { isVapor } from "../fx/particles";
import type { WeatherFlake } from "../fx/seasonWeather";
import type { Bird, Particle, ParticleKind, Rubble } from "../structure/types";
import type { WeatherKind } from "../world/season";
import { worldToScreen } from "../world/iso";
import { cellColors, drawOrientedGround, drawOrientedIsoBox, drawWorldPoly, PAL } from "./drawIso";
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

/** `w` runs along the flake's heading and stretches with its `len`; `h` is a falling streak's height. */
interface FlakeStyle { color: number; w: number; d: number; h?: number; alpha?: number }
const FLAKE_STYLE: Partial<Record<WeatherKind, FlakeStyle>> = {
  rain: { color: 0x9eb4c4, w: 0.05, d: 0.16 },
  leaves: { color: 0xc47a32, w: 0.12, d: 0.08 },
  // Haboob sheets: long translucent ochre streaks lying on the wind.
  dust: { color: 0xc9a06a, w: 0.7, d: 0.1, h: 0.03, alpha: 0.34 },
  // Monsoon and squall rain falls as tall warm-grey streaks.
  downpour: { color: 0xa9b6bd, w: 0.03, d: 0.05, h: 0.5, alpha: 0.5 },
  // Heat haze: pale bands hugging the ground.
  shimmer: { color: 0xfff2d0, w: 1.1, d: 0.05, h: 0.01, alpha: 0.14 },
};
const SNOW_FLAKE: FlakeStyle = { color: 0xf4f7fb, w: 0.12, d: 0.08 };

export function drawWeatherFlake(g: Graphics, flake: WeatherFlake): void {
  const style = FLAKE_STYLE[flake.kind] ?? SNOW_FLAKE;
  const { color } = style;
  drawOrientedIsoBox(g, flake.x, flake.y, flake.heading, style.w * flake.len, style.d, flake.z, style.h ?? 0.04, color, color, color, style.alpha ?? 0.7);
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
  if (isVapor(p.kind)) {
    drawVapor(g, p, fade, 0.6);
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
  g.fill({ color: p.tint ?? PAL.dust, alpha: 0.32 * fade });
}

const CHIP_COLORS: Partial<Record<ParticleKind, { color: number; dark: number }>> = {
  wood: { color: PAL.wood, dark: PAL.woodDark },
  brick: { color: PAL.brick, dark: PAL.brickDark },
  metal: { color: PAL.metal, dark: PAL.metalDark },
  glass: { color: 0xa8c4d0, dark: PAL.concreteDark },
  spark: { color: 0xffc860, dark: 0xff8a24 },
  arc: { color: 0xd8ecff, dark: 0x6fa8ff },
};
const CONCRETE_CHIP = { color: PAL.concrete, dark: PAL.concreteDark };
const SPARK_CORE = 0xfffbe8;
const SPARK_GLOW = 0xffa630;
const ARC_GLOW = 0x5aa2ff;
const VAPOR = { steam: { color: 0xf1f6f7, alpha: 0.5 }, soot: { color: 0x2a2521, alpha: 0.58 } } as const;

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

/** A hot streak along its flight, a white core over an orange glow, with no ground shadow. */
function drawSpark(g: Graphics, p: Particle, fade: number): void {
  const a = worldToScreen(p.x, p.y, p.z);
  const b = worldToScreen(p.x - p.vx * 0.06, p.y - p.vy * 0.06, p.z - p.vz * 0.06);
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: p.kind === "arc" ? ARC_GLOW : SPARK_GLOW, width: 4.5, alpha: 0.6 * fade, cap: "round" });
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: SPARK_CORE, width: 1.8, alpha: fade, cap: "round" });
}

/** Steam and soot billow: one soft six-sided puff that swells as it thins out. */
function drawVapor(g: Graphics, p: Particle, fade: number, scale = 1): void {
  if (!isVapor(p.kind)) return;
  const { color, alpha } = VAPOR[p.kind];
  const c = worldToScreen(p.x, p.y, p.z);
  const r = (5 + p.size * 16) * (1 + (1 - fade) * 1.3) * scale;
  g.poly([c.x - r, c.y, c.x - r * 0.5, c.y - r * 0.7, c.x + r * 0.5, c.y - r * 0.7, c.x + r, c.y, c.x + r * 0.5, c.y + r * 0.6, c.x - r * 0.5, c.y + r * 0.6]);
  g.fill({ color, alpha: alpha * fade });
}

export function drawParticle(g: Graphics, p: Particle): void {
  const fade = Math.min(1, p.life / p.maxLife);
  if (p.kind === "spark" || p.kind === "arc") {
    drawSpark(g, p, fade);
    return;
  }
  if (isVapor(p.kind)) {
    drawVapor(g, p, fade);
    return;
  }
  // A dust puff is translucent and casts nothing worth drawing.
  if (p.kind === "dust") {
    drawDustSpeck(g, p, fade);
    return;
  }
  // The contact shadow is a few pixels; a rect tessellates to two triangles where an ellipse takes dozens.
  const s = worldToScreen(p.x, p.y, 0);
  g.rect(s.x - 3, s.y - 1.4, 6, 2.8);
  g.fill({ color: PAL.shadow, alpha: 0.2 * fade });
  const { color, dark, len, wid } = particleChip(p);
  if (p.kind === "crop") {
    drawOrientedIsoBox(g, p.x, p.y, p.rot, len, wid, p.z, Math.max(0.03, p.size * 0.12), color, dark, shade(color, 0.8), 0.88 * fade);
    return;
  }
  drawOrientedIsoBox(g, p.x, p.y, p.rot, len, wid, p.z, Math.max(0.04, p.size * 0.2), color, dark, color, 0.92 * fade);
}

type Tone = ReturnType<typeof cellColors>;

const MORTAR = 0xb9a48c;
const RAW_WOOD = 0xe2b877;
const REBAR = 0x5a3526;
const RUST = 0x8a5234;
const SHARD = 0xc4e4ec;

const toned = (c: Tone, m: number): Tone => ({ top: shade(c.top, m), left: shade(c.left, m), right: shade(c.right, m) });
const flat = (color: number): Tone => ({ top: color, left: shade(color, 0.62), right: shade(color, 0.8) });

/** One box of a body, placed in the body's own frame (along, across) and turned from its heading. */
function part(g: Graphics, r: Rubble, along: number, across: number, turn: number, w: number, d: number, z: number, h: number, c: Tone, alpha = 1): void {
  const fx = Math.cos(r.heading), fy = Math.sin(r.heading);
  drawOrientedIsoBox(g, r.x + fx * along - fy * across, r.y + fy * along + fx * across, r.heading + turn, w, d, r.elev + z, h, c.top, c.left, c.right, alpha);
}

/**
 * A body reads as what it broke off: bonded brick with mortar, concrete with rebar, bent steel,
 * split timber, flat glass shards. Shape and tone come from the body's seed, so a piece keeps
 * its look while it tumbles and rests.
 */
export function drawDebris(g: Graphics, r: Rubble): void {
  const rng = new Rng(r.seed);
  const h = Math.max(0.05, r.thickness);
  if (r.material === "glass") return drawGlassDebris(g, r, rng);
  drawOrientedGround(g, r.x, r.y, r.heading, r.w * 1.1, r.d * 1.1, PAL.shadow, 0.26);
  if (r.skin === "roofing") return drawRoofingDebris(g, r, h, rng);
  const c = toned(cellColors(r.material, true), rng.range(0.84, 1.14));
  if (r.material === "brick") drawBrickDebris(g, r, h, rng, c);
  else if (r.material === "concrete") drawConcreteDebris(g, r, h, rng, c);
  else if (r.material === "metal") drawSteelDebris(g, r, h, rng, c);
  else drawTimberDebris(g, r, h, rng, c);
}

const ROOFING_DEBRIS = {
  metal: { top: PAL.roofMetal, edge: PAL.metalDark, under: PAL.metalDark, underDark: PAL.metal },
  shingle: { top: PAL.roofShingle, edge: PAL.roofShingleDark, under: PAL.wood, underDark: PAL.woodDark },
};

/** A torn roof panel: decking under its covering, and on shingles sometimes a folded flap. */
function drawRoofingDebris(g: Graphics, r: Rubble, h: number, rng: Rng): void {
  const metal = r.material === "metal";
  const { top, edge, under, underDark } = metal ? ROOFING_DEBRIS.metal : ROOFING_DEBRIS.shingle;
  part(g, r, 0, 0, 0, r.w, r.d, 0, Math.max(0.04, h * 0.45), { top: under, left: underDark, right: under }, 0.95);
  part(g, r, 0, 0, 0, r.w * 0.9, r.d * 0.86, h * 0.28, Math.max(0.05, h * 0.72), { top, left: edge, right: edge });
  if (metal || rng.next() <= 0.55) return;
  part(g, r, r.w * 0.28, 0, rng.range(-0.18, 0.18), r.w * 0.26, r.d * 0.2, h * 0.55, h * 0.28,
    { top: PAL.roofShingleDark, left: PAL.woodDark, right: PAL.roofShingle });
}

/** Bonded courses on a mortar bed, lying in their own mortar dust; fragments are single bricks and bats. */
function drawBrickDebris(g: Graphics, r: Rubble, h: number, rng: Rng, c: Tone): void {
  if (r.layer === "fragment") {
    part(g, r, 0, 0, 0, r.w, r.d, 0, h, c);
    return;
  }
  drawOrientedGround(g, r.x, r.y, r.heading + 0.4, r.w * 1.5, r.d * 1.7, MORTAR, 0.2);
  part(g, r, 0, 0, 0, r.w, r.d, 0, h * 0.45, c);
  part(g, r, 0, 0, 0, r.w * 0.97, r.d * 0.97, h * 0.45, h * 0.1, flat(MORTAR));
  part(g, r, rng.range(-0.1, 0.1) * r.w, 0, rng.range(-0.18, 0.18), r.w * rng.range(0.55, 0.9), r.d * 0.94, h * 0.55, h * 0.45, toned(c, rng.range(0.9, 1.12)));
  if (rng.next() > 0.4) part(g, r, rng.range(-0.3, 0.3) * r.w, rng.range(-0.3, 0.3) * r.d, rng.range(-1.2, 1.2), 0.2, 0.1, h, 0.07, toned(c, 1.16));
}

/** A slab lump with a paler broken face on top and bent rebar out of one end. */
function drawConcreteDebris(g: Graphics, r: Rubble, h: number, rng: Rng, c: Tone): void {
  part(g, r, 0, 0, 0, r.w * rng.range(0.85, 1.05), r.d * rng.range(0.75, 1), 0, h, c);
  if (r.layer === "fragment") return;
  part(g, r, rng.range(-0.16, 0.16) * r.w, rng.range(-0.16, 0.16) * r.d, rng.range(-0.6, 0.6), r.w * rng.range(0.35, 0.6), r.d * rng.range(0.3, 0.55), h, h * rng.range(0.2, 0.45), toned(c, 1.14));
  const end = rng.next() > 0.5 ? 1 : -1;
  for (let i = 0; i < 2; i++) {
    const len = rng.range(0.22, 0.42);
    part(g, r, end * (r.w + len) * 0.5, (i - 0.5) * r.d * 0.5, rng.range(-0.45, 0.45), len, 0.035, h * rng.range(0.3, 0.7), 0.035, flat(REBAR));
  }
}

/** A girder bent at a kink, a buckled ribbed sheet, or a torn plate; some pieces have rusted. */
function drawSteelDebris(g: Graphics, r: Rubble, h: number, rng: Rng, c: Tone): void {
  if (rng.next() > 0.7) c = flat(RUST);
  if (r.shape === "panel") {
    for (let i = 0; i < 3; i++) part(g, r, 0, (i - 1) * r.d * 0.32, rng.range(-0.07, 0.07), r.w, r.d * 0.3, i === 1 ? h * 0.7 : 0, h, toned(c, i === 1 ? 1.18 : 0.92));
    return;
  }
  if (r.shape !== "beam") {
    part(g, r, 0, 0, 0, r.w, r.d, 0, h, c);
    return;
  }
  const kink = rng.range(0.25, 0.75) * (rng.next() > 0.5 ? 1 : -1);
  const a = r.w * rng.range(0.4, 0.62), b = r.w - a;
  part(g, r, (a - r.w) * 0.5, 0, 0, a, r.d, 0, h, c);
  part(g, r, (a - r.w) * 0.5, 0, 0, a, r.d * 0.34, h, h * 0.5, toned(c, 1.2));
  part(g, r, a - r.w * 0.5 + Math.cos(kink) * b * 0.5, Math.sin(kink) * b * 0.5, kink, b, r.d, 0, h, toned(c, 1.1));
}

/** A plank with one end split into pale splinters, boards sprung apart, or a short split block. */
function drawTimberDebris(g: Graphics, r: Rubble, h: number, rng: Rng, c: Tone): void {
  if (r.shape === "panel") {
    for (let i = 0; i < 3; i++) part(g, r, rng.range(-0.07, 0.07) * r.w, (i - 1) * r.d * 0.36, rng.range(-0.1, 0.1), r.w * rng.range(0.78, 1), r.d * 0.3, i * h * 0.15, h * 0.7, toned(c, 0.9 + i * 0.1));
    return;
  }
  part(g, r, 0, 0, 0, r.w, r.d, 0, h, c);
  const end = rng.next() > 0.5 ? 1 : -1;
  const raw = flat(RAW_WOOD);
  for (let i = -1; i <= 1; i++) {
    const len = rng.range(0.1, 0.24);
    part(g, r, end * (r.w + len) * 0.5, i * r.d * 0.36, i * end * 0.3 + rng.range(-0.1, 0.1), len, r.d * 0.26, h * 0.2, h * 0.55, raw);
  }
}

/** Flat, see-through shards with one bright facet catching the light; no shadow. */
function drawGlassDebris(g: Graphics, r: Rubble, rng: Rng): void {
  const z = r.elev + 0.02;
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2), len = Math.max(0.14, r.w) * rng.range(0.5, 1), wid = len * rng.range(0.22, 0.45);
    const x = r.x + rng.range(-0.5, 0.5) * r.w, y = r.y + rng.range(-0.5, 0.5) * r.d;
    const ax = Math.cos(a), ay = Math.sin(a);
    drawWorldPoly(g, [{ x: x + ax * len, y: y + ay * len, z }, { x: x - ay * wid, y: y + ax * wid, z }, { x: x + ay * wid, y: y - ax * wid, z }], i ? SHARD : 0xffffff, i ? 0.55 : 0.85);
  }
}

export function drawBird(g: Graphics, bird: Bird): void {
  const c = worldToScreen(bird.x, bird.y, bird.z);
  g.poly([c.x, c.y, c.x + 6, c.y - 2, c.x + 2, c.y + 1]);
  g.fill({ color: PAL.bird, alpha: Math.min(1, bird.life) });
}
