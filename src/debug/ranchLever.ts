/**
 * Ranch demolition lever.
 *
 * Deterministically stages the d10 ranch, steps collapse, writes judged frames.
 * SVG output is a diagnostic illustration of floor/roof exposure, not PixiJS gameplay.
 * Safe to rerun: wipes and overwrites `.ranch-frames/`.
 *
 *   npx vitest run src/debug/ranchLever.test.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SIM_DT } from "../game/constants";
import { DEFAULT_DISTRICT_SEEDS } from "../game/session";
import { ParticlePool } from "../fx/particles";
import { extractBuildingSurfaces } from "../render/buildingSurfaces";
import { roofShowsFrame } from "../render/interiorDraw";
import { applyCellDamage } from "../structure/building";
import {
  fixtureExposed,
  interiorFloorSpans,
  type InteriorFloorSpan,
} from "../structure/interior";
import type { Building } from "../structure/types";
import { cellPresent } from "../structure/types";
import { createDozer } from "../vehicle/dozer";
import { worldToScreen } from "../world/iso";
import { createTown } from "../world/town";
import { stepWorld, type Upgrades } from "../sim/worldSim";

export const RANCH_LEVER_DIR = ".ranch-frames";

const UPGRADES: Upgrades = { blade: 0, engine: 0, push: 0 };
const GUTTER_EPS = 0.08;
const COVER_MIN = 0.72;

export interface LeverCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface LeverPhase {
  id: string;
  label: string;
  kind: "closed" | "open" | "rubble";
  tick: number;
  simSec: number;
  checks: LeverCheck[];
  judgment: string;
  svg: string;
  metrics: PhaseMetrics;
}

export interface PhaseMetrics {
  cellStates: string;
  holeColumns: number[];
  spans: { gx0: number; gx1: number; gy0: number; gy1: number; finish: string }[];
  openingCells: number;
  coveredOpening: number;
  coverRatio: number;
  gutterLeft: number;
  gutterRight: number;
  spanGaps: number;
  solidRoofOverHole: number;
  fixturesVisible: number;
}

export interface LeverReport {
  command: string;
  district: string;
  seed: number;
  outDir: string;
  phases: LeverPhase[];
  failed: { phase: string; check: string; detail: string }[];
  ok: boolean;
}

function ranchOf(town: ReturnType<typeof createTown>): Building {
  const ranch = town.buildings.find((b) => b.archetypeId === "ranch");
  if (!ranch) throw new Error("d10 town has no ranch");
  return ranch;
}

function smash(building: Building, particles: ParticlePool, gx: number, gy: number, floor = 0): void {
  const cell = building.grid[floor]?.[gx]?.[gy];
  if (!cell || cell.state === "gone") return;
  applyCellDamage(building, cell, 999, 0, 1, particles, []);
}

function southHoleColumns(b: Building, floor = 0): number[] {
  const out: number[] = [];
  const gy = b.d - 1;
  for (let gx = 0; gx < b.w; gx++) {
    const cell = b.grid[floor]?.[gx]?.[gy];
    if (!cell || !cellPresent(cell)) out.push(gx);
  }
  return out;
}

function openingCells(b: Building, floor = 0): { gx: number; gy: number }[] {
  const holes = southHoleColumns(b, floor);
  const cells: { gx: number; gy: number }[] = [];
  for (const gx of holes) {
    for (let gy = b.d - 1; gy >= 0; gy--) {
      const cell = b.grid[floor]?.[gx]?.[gy];
      if (gy === b.d - 1 || !cell || !cellPresent(cell) || cell.state === "breached") {
        cells.push({ gx, gy });
        continue;
      }
      const south = b.grid[floor]?.[gx]?.[gy + 1];
      if (south && !cellPresent(south)) {
        cells.push({ gx, gy });
        continue;
      }
      break;
    }
  }
  return cells;
}

function spanCovers(span: InteriorFloorSpan, gx: number, gy: number): boolean {
  return gx >= span.gx0 && gx <= span.gx1 && gy >= span.gy0 && gy <= span.gy1;
}

function spanGapCount(b: Building, spans: InteriorFloorSpan[]): number {
  const covered = (gx: number, gy: number) => spans.some((s) => spanCovers(s, gx, gy));
  let gaps = 0;
  for (let gy = 0; gy < b.d; gy++) {
    let prev = -2;
    for (let gx = 0; gx < b.w; gx++) {
      if (!covered(gx, gy)) continue;
      if (prev >= 0 && gx > prev + 1) gaps++;
      prev = gx;
    }
  }
  for (let gx = 0; gx < b.w; gx++) {
    let prev = -2;
    for (let gy = 0; gy < b.d; gy++) {
      if (!covered(gx, gy)) continue;
      if (prev >= 0 && gy > prev + 1) gaps++;
      prev = gy;
    }
  }
  return gaps;
}

function wingInners(b: Building, holes: number[]): { left: number; right: number } | null {
  if (holes.length === 0) return null;
  const cs = b.cellSize;
  const minH = Math.min(...holes);
  const maxH = Math.max(...holes);
  return {
    left: b.x + minH * cs,
    right: b.x + (maxH + 1) * cs,
  };
}

function floorXRange(b: Building, spans: InteriorFloorSpan[], holes: number[]): { min: number; max: number } | null {
  if (spans.length === 0 || holes.length === 0) return null;
  const minH = Math.min(...holes);
  const maxH = Math.max(...holes);
  const cs = b.cellSize;
  let min = Infinity;
  let max = -Infinity;
  for (const s of spans) {
    if (s.gx1 < minH || s.gx0 > maxH) continue;
    min = Math.min(min, b.x + s.gx0 * cs);
    max = Math.max(max, b.x + (s.gx1 + 1) * cs);
  }
  if (!Number.isFinite(min)) return null;
  return { min, max };
}

function solidRoofOverHole(b: Building, holes: number[]): number {
  let n = 0;
  for (const roof of b.roofs) {
    if (roof.state === "gone" || roof.state === "falling") continue;
    const hitsHole = roof.support.some((s) => holes.includes(s.gx));
    if (!hitsHole) continue;
    n++;
  }
  return n;
}

function cellStateSig(b: Building): string {
  return b.cells.map((c) => `${c.gx},${c.gy}:${c.state[0]}`).join(" ");
}

function measure(b: Building): PhaseMetrics {
  const spans = interiorFloorSpans(b);
  const holes = southHoleColumns(b);
  const opening = openingCells(b);
  const covered = opening.filter((c) => spans.some((s) => spanCovers(s, c.gx, c.gy))).length;
  const wings = wingInners(b, holes);
  const floorX = floorXRange(b, spans, holes);
  const gutterLeft = wings && floorX ? floorX.min - wings.left : 0;
  const gutterRight = wings && floorX ? wings.right - floorX.max : 0;
  return {
    cellStates: cellStateSig(b),
    holeColumns: holes,
    spans: spans.map((s) => ({ gx0: s.gx0, gx1: s.gx1, gy0: s.gy0, gy1: s.gy1, finish: s.finish })),
    openingCells: opening.length,
    coveredOpening: covered,
    coverRatio: opening.length === 0 ? 1 : covered / opening.length,
    gutterLeft,
    gutterRight,
    spanGaps: spanGapCount(b, spans),
    solidRoofOverHole: solidRoofOverHole(b, holes),
    fixturesVisible: b.fixtures.filter((f) => fixtureExposed(b, f)).length,
  };
}

function judge(kind: LeverPhase["kind"], m: PhaseMetrics, phaseId: string): LeverCheck[] {
  if (kind === "closed") {
    return [
      {
        id: "closed-shell",
        ok: m.openingCells === 0 && m.spans.length === 0,
        detail: `opening=${m.openingCells} spans=${m.spans.length}`,
      },
    ];
  }
  if (kind === "rubble") {
    return [
      {
        id: "not-a-house",
        ok: m.holeColumns.length >= 3,
        detail: `holes=${m.holeColumns.join(",")}`,
      },
    ];
  }
  const coverOk = m.coverRatio >= COVER_MIN;
  const gutterOk = m.gutterLeft <= GUTTER_EPS && m.gutterRight <= GUTTER_EPS;
  const keepRoof = phaseId !== "half-destroyed";
  const roofOk = keepRoof ? m.solidRoofOverHole > 0 : true;
  const gapOk = m.spanGaps === 0;
  const furnOk = m.fixturesVisible > 0;
  return [
    { id: "opening-not-grass", ok: coverOk, detail: `cover=${m.coverRatio.toFixed(2)} (${m.coveredOpening}/${m.openingCells})` },
    {
      id: "floor-meets-wings",
      ok: gutterOk,
      detail: `gutter L=${m.gutterLeft.toFixed(2)} R=${m.gutterRight.toFixed(2)}`,
    },
    { id: "roof-stays-on-breach", ok: roofOk, detail: `solidRoofOverHole=${m.solidRoofOverHole}` },
    { id: "no-span-gutters", ok: gapOk, detail: `spanGaps=${m.spanGaps}` },
    { id: "furniture-visible", ok: furnOk, detail: `fixturesVisible=${m.fixturesVisible}` },
  ];
}

function judgmentLine(checks: LeverCheck[]): string {
  const bad = checks.filter((c) => !c.ok);
  if (bad.length === 0) return "PASS";
  return `FAIL ${bad.map((c) => `${c.id}(${c.detail})`).join("; ")}`;
}

function isoPoly(x: number, y: number, w: number, d: number, z: number): string {
  const pts = [
    worldToScreen(x, y, z),
    worldToScreen(x + w, y, z),
    worldToScreen(x + w, y + d, z),
    worldToScreen(x, y + d, z),
  ];
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function phaseSvg(b: Building): string {
  const cs = b.cellSize;
  const surfaces = extractBuildingSurfaces(b);
  const parts: string[] = [];
  parts.push(`<polygon points="${isoPoly(b.x, b.y, b.w * cs, b.d * cs, 0)}" fill="#7cb342" />`);
  for (const span of interiorFloorSpans(b)) {
    const fill = span.finish === "tile" ? "#c4c0b4" : span.finish === "linoleum" ? "#c4a86a" : "#c49a5c";
    parts.push(
      `<polygon points="${isoPoly(b.x + span.gx0 * cs, b.y + span.gy0 * cs, (span.gx1 - span.gx0 + 1) * cs, (span.gy1 - span.gy0 + 1) * cs, 0.11)}" fill="${fill}" />`,
    );
  }
  for (const wall of surfaces.walls) {
    if (wall.dir !== "south") continue;
    const x = b.x + wall.gx0 * cs;
    const y = b.y + (wall.gy0 + 1) * cs;
    const w = (wall.gx1 - wall.gx0 + 1) * cs;
    const a = worldToScreen(x, y, 0);
    const c = worldToScreen(x + w, y, 2.2);
    const e = worldToScreen(x + w, y, 0);
    const f = worldToScreen(x, y, 2.2);
    parts.push(
      `<polygon points="${a.x.toFixed(1)},${a.y.toFixed(1)} ${e.x.toFixed(1)},${e.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)} ${f.x.toFixed(1)},${f.y.toFixed(1)}" fill="#c68654" />`,
    );
  }
  for (const roof of b.roofs) {
    if (roof.state === "gone") continue;
    const falling = roof.state === "falling";
    const verts = roof.verts.map((v) => worldToScreen(v.x, v.y, v.z));
    const pts = verts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const framing = roofShowsFrame(b, roof);
    parts.push(
      `<polygon points="${pts}" fill="${falling ? "#6a3428" : "#8b3a2a"}" stroke="${framing ? "#6d4c2b" : "#6b2a1e"}" stroke-width="${framing ? 1.4 : 0.6}" fill-opacity="${falling ? 0.55 : 0.92}" />`,
    );
  }
  for (const f of b.fixtures) {
    if (!fixtureExposed(b, f)) continue;
    parts.push(
      `<polygon points="${isoPoly(f.x, f.y, f.w, f.d, 0.2)}" fill="${f.broken ? "#6d5a3a" : "#5a8f4a"}" />`,
    );
  }
  const xs = [worldToScreen(b.x, b.y, 0), worldToScreen(b.x + b.w * cs, b.y, 0), worldToScreen(b.x, b.y + b.d * cs, 3), worldToScreen(b.x + b.w * cs, b.y + b.d * cs, 3)];
  const minX = Math.min(...xs.map((p) => p.x)) - 8;
  const minY = Math.min(...xs.map((p) => p.y)) - 8;
  const maxX = Math.max(...xs.map((p) => p.x)) + 8;
  const maxY = Math.max(...xs.map((p) => p.y)) + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}" width="280" height="160">${parts.join("")}</svg>`;
}

function capture(id: string, label: string, kind: LeverPhase["kind"], tick: number, b: Building): LeverPhase {
  const metrics = measure(b);
  const checks = judge(kind, metrics, id);
  return {
    id,
    label,
    kind,
    tick,
    simSec: tick * SIM_DT,
    checks,
    judgment: judgmentLine(checks),
    svg: phaseSvg(b),
    metrics,
  };
}

function writeArtifacts(report: LeverReport): void {
  rmSync(RANCH_LEVER_DIR, { recursive: true, force: true });
  mkdirSync(RANCH_LEVER_DIR, { recursive: true });
  writeFileSync(join(RANCH_LEVER_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const cards = report.phases
    .map((p) => {
      const tone = p.judgment.startsWith("PASS") ? "#1b5e20" : "#b71c1c";
      return `<figure><figcaption><strong>${p.label}</strong> · t=${p.tick} (${p.simSec.toFixed(2)}s)<br/><span style="color:${tone}">${p.judgment}</span></figcaption>${p.svg}</figure>`;
    })
    .join("\n");
  const html = `<!doctype html><meta charset="utf-8"><title>Ranch demolition lever</title>
<style>body{font:14px/1.4 sans-serif;background:#111;color:#eee;padding:16px}figure{display:inline-block;margin:8px;background:#1c1c1c;padding:8px;vertical-align:top}figcaption{max-width:280px;margin-bottom:6px}svg{background:#9ccc65;display:block}</style>
<h1>Ranch demolition lever</h1>
<p>Diagnostic illustration of structural exposure — not a PixiJS gameplay capture.</p>
<p>${report.command} · seed ${report.seed} · ${report.ok ? "PASS" : "FAIL"}</p>
${cards}
`;
  writeFileSync(join(RANCH_LEVER_DIR, "index.html"), html);
}

export function runRanchLever(outDir = RANCH_LEVER_DIR): LeverReport {
  const seed = DEFAULT_DISTRICT_SEEDS.d10;
  const town = createTown({ district: "d10", seed });
  const ranch = ranchOf(town);
  const particles = new ParticlePool();
  const dozer = createDozer(ranch.x + (ranch.w * ranch.cellSize) * 0.5, ranch.y + ranch.d * ranch.cellSize + 3.4, -Math.PI / 2);
  let tick = 0;
  const phases: LeverPhase[] = [];

  const step = (n: number): void => {
    for (let i = 0; i < n; i++) {
      stepWorld(town, dozer, particles, UPGRADES, SIM_DT);
      tick++;
    }
  };

  phases.push(capture("intact", "intact", "closed", tick, ranch));

  smash(ranch, particles, 2, ranch.d - 1);
  step(4);
  phases.push(capture("first-south-breach", "first south breach", "open", tick, ranch));

  smash(ranch, particles, 1, ranch.d - 1);
  smash(ranch, particles, 3, ranch.d - 1);
  step(12);
  phases.push(capture("mid-collapse-a", "mid-collapse (breached)", "open", tick, ranch));
  step(20);
  phases.push(capture("mid-collapse-b", "mid-collapse (sag)", "open", tick, ranch));
  step(24);
  phases.push(capture("mid-collapse-c", "mid-collapse (fall)", "open", tick, ranch));

  let guard = 0;
  while (guard++ < 80) {
    const south = [1, 2, 3].map((gx) => ranch.grid[0]![gx]![ranch.d - 1]!);
    if (south.every((c) => c.state === "gone")) break;
    step(1);
  }
  phases.push(capture("south-middle-open", "south-middle open (screenshot state)", "open", tick, ranch));

  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < ranch.d; gy++) smash(ranch, particles, gx, gy);
  }
  step(16);
  phases.push(capture("half-destroyed", "half destroyed", "open", tick, ranch));

  for (const cell of ranch.cells) {
    if (cell.gx === ranch.w - 1 && cell.gy === 0) continue;
    smash(ranch, particles, cell.gx, cell.gy);
  }
  step(24);
  phases.push(capture("near-total", "near-total", "rubble", tick, ranch));

  const resetTown = createTown({ district: "d10", seed });
  phases.push(capture("reset", "reset", "closed", 0, ranchOf(resetTown)));

  const failed: LeverReport["failed"] = [];
  for (const phase of phases) {
    for (const check of phase.checks) {
      if (!check.ok) failed.push({ phase: phase.id, check: check.id, detail: check.detail });
    }
  }
  const report: LeverReport = {
    command: "npx vitest run src/debug/ranchLever.test.ts",
    district: "d10",
    seed,
    outDir,
    phases,
    failed,
    ok: failed.length === 0,
  };
  writeArtifacts(report);
  return report;
}
