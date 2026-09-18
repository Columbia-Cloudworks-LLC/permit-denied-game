import { campaignLevelById } from "../game/campaign";
import { cameraFocus } from "../game/camera";
import { ParticlePool } from "../fx/particles";
import { applyCellDamage } from "../structure/building";
import { createDozer } from "../vehicle/dozer";
import { worldBoundsToScreen } from "../world/iso";
import { createTown, type Town } from "../world/town";
import { WorldRenderer } from "./WorldRenderer";

export const DENSE_CITY_SEED = 19;
export const DENSE_CITY_LEVEL = "city-downtown" as const;

export const DESKTOP_VIEW = { w: 1440, h: 900 };
export const MOBILE_VIEW = { w: 390, h: 844 };

export interface DenseCityScene {
  id: string;
  label: string;
  view: { w: number; h: number };
  overview: boolean;
  demolish: boolean;
}

export const DENSE_CITY_SCENES: readonly DenseCityScene[] = [
  { id: "intact-street-desktop", label: "intact street desktop", view: DESKTOP_VIEW, overview: false, demolish: false },
  { id: "intact-street-mobile", label: "intact street mobile", view: MOBILE_VIEW, overview: false, demolish: false },
  { id: "intact-overview-desktop", label: "intact overview desktop", view: DESKTOP_VIEW, overview: true, demolish: false },
  { id: "intact-overview-mobile", label: "intact overview mobile", view: MOBILE_VIEW, overview: true, demolish: false },
  { id: "demolish-street-desktop", label: "active demolition street desktop", view: DESKTOP_VIEW, overview: false, demolish: true },
  { id: "demolish-overview-desktop", label: "active demolition overview desktop", view: DESKTOP_VIEW, overview: true, demolish: true },
  { id: "demolish-street-mobile", label: "active demolition street mobile", view: MOBILE_VIEW, overview: false, demolish: true },
];

export interface DenseCitySample {
  id: string;
  label: string;
  view: { w: number; h: number };
  samples: number;
  drawMs: { mean: number; p50: number; p90: number; max: number };
  commands: number;
  visible: number;
  total: number;
  rebuilt: number;
  cached: number;
  buildings: number;
  cells: number;
  terrainChunks: number;
  terrainCells: number;
  groundRebuilds: number;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] ?? 0;
}

function summarize(values: number[]): DenseCitySample["drawMs"] {
  const sum = values.reduce((n, v) => n + v, 0);
  return {
    mean: sum / Math.max(1, values.length),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    max: percentile(values, 100),
  };
}

export function createDenseCityTown(seed = DENSE_CITY_SEED): Town {
  return createTown({
    district: "d30",
    seed,
    campaign: campaignLevelById(DENSE_CITY_LEVEL),
  });
}

export function smashDenseCity(town: Town, count = 4): void {
  const particles = new ParticlePool();
  const targets = [...town.buildings]
    .sort((a, b) => a.x + a.y - (b.x + b.y))
    .slice(0, count);
  for (const building of targets) {
    for (const cell of building.cells.slice(0, Math.ceil(building.cells.length * 0.4))) {
      applyCellDamage(building, cell, 999, 1, 0, particles, []);
    }
  }
}

export function frameDenseCityOverview(town: Town, viewW: number, viewH: number): { camX: number; camY: number; zoom: number } {
  const pad = 8;
  const buildings = town.buildings;
  const minX = buildings.length ? Math.min(...buildings.map((building) => building.x)) - pad : town.minX - pad;
  const minY = buildings.length ? Math.min(...buildings.map((building) => building.y)) - pad : town.minY - pad;
  const maxX = buildings.length
    ? Math.max(...buildings.map((building) => building.x + building.w * building.cellSize)) + pad
    : town.maxX + pad;
  const maxY = buildings.length
    ? Math.max(...buildings.map((building) => building.y + building.d * building.cellSize)) + pad
    : town.maxY + pad;
  const tallest = Math.max(2, ...buildings.map((building) => building.floors * 0.45 + 1.5));
  const box = worldBoundsToScreen(minX, minY, Math.max(8, maxX - minX), Math.max(8, maxY - minY), 0, tallest);
  const zoom = Math.min(0.95, Math.max(0.1, 0.86 * Math.min(viewW / Math.max(1, box.maxX - box.minX), viewH / Math.max(1, box.maxY - box.minY))));
  return {
    zoom,
    camX: ((box.minX + box.maxX) / 2) * zoom,
    camY: ((box.minY + box.maxY) / 2) * zoom,
  };
}

export function measureDenseCityScene(
  scene: DenseCityScene,
  options: { warmup?: number; frames?: number; seed?: number } = {},
): DenseCitySample {
  const warmup = options.warmup ?? 3;
  const frames = options.frames ?? 18;
  const town = createDenseCityTown(options.seed);
  if (scene.demolish) smashDenseCity(town);
  const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
  if (scene.demolish && town.buildings[0]) {
    dozer.x = town.buildings[0].x + 1.2;
    dozer.y = town.buildings[0].y + town.buildings[0].d * town.buildings[0].cellSize + 1.4;
  }
  const renderer = new WorldRenderer();
  renderer.debug.effects = false;
  renderer.showNhood = scene.overview;
  if (scene.overview) {
    const cam = frameDenseCityOverview(town, scene.view.w, scene.view.h);
    renderer.zoom = cam.zoom;
    renderer.camX = cam.camX;
    renderer.camY = cam.camY;
  } else {
    renderer.zoom = 1.15;
    const focus = cameraFocus(dozer.x, dozer.y, 0.4, renderer.zoom);
    renderer.camX = focus.x;
    renderer.camY = focus.y;
  }
  renderer.layout(scene.view.w, scene.view.h, 0, 0);
  const particles = new ParticlePool();
  const times: number[] = [];
  for (let i = 0; i < warmup + frames; i++) {
    const t0 = performance.now();
    renderer.draw(town, dozer, particles, []);
    const ms = performance.now() - t0;
    if (i >= warmup) times.push(ms);
  }
  const sample: DenseCitySample = {
    id: scene.id,
    label: scene.label,
    view: scene.view,
    samples: times.length,
    drawMs: summarize(times),
    commands: renderer.stats.commands,
    visible: renderer.stats.visible,
    total: renderer.stats.total,
    rebuilt: renderer.stats.rebuilt,
    cached: renderer.stats.cached,
    buildings: town.buildings.length,
    cells: town.buildings.reduce((n, building) => n + building.cells.length, 0),
    terrainChunks: renderer.stats.terrainChunks,
    terrainCells: renderer.stats.terrainCells,
    groundRebuilds: renderer.stats.groundRebuilds,
  };
  renderer.invalidate();
  renderer.root.destroy({ children: true });
  return sample;
}

export function measureDenseCityBench(options?: { warmup?: number; frames?: number; seed?: number }): DenseCitySample[] {
  return DENSE_CITY_SCENES.map((scene) => measureDenseCityScene(scene, options));
}

export function formatDenseCityBench(samples: readonly DenseCitySample[]): string {
  return samples
    .map((sample) =>
      `[dense-city] ${sample.id} n=${sample.samples} draw mean=${sample.drawMs.mean.toFixed(2)}ms p50=${sample.drawMs.p50.toFixed(2)} p90=${sample.drawMs.p90.toFixed(2)} max=${sample.drawMs.max.toFixed(2)} cmds=${sample.commands} vis=${sample.visible}/${sample.total} rebuilt=${sample.rebuilt} cached=${sample.cached} buildings=${sample.buildings} cells=${sample.cells} view=${sample.view.w}x${sample.view.h}`,
    )
    .join("\n");
}
