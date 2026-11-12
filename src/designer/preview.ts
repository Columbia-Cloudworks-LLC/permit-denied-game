import { Application } from 'pixi.js';
import { ParticlePool } from '../fx/particles';
import { WorldRenderer } from '../render/WorldRenderer';
import { defaultDebugView } from '../debug/view';
import { frameIsolateLot, instantiateIsolateDefinition, type IsolateLot } from '../debug/isolateLot';
import { stampRegionalExterior } from '../structure/regionalExterior';
import { climateById } from '../world/climate';
import { townSeasonState } from '../world/groundCondition';
import type { SeasonId } from '../world/season';
import type { Archetype } from '../world/archetypes';

export type PreviewView = 'intact' | 'cutaway';

/** How the isolated lot is dressed: a climate preset's regional roof, walls and kit, its season, and the rooftop gear layer. */
export interface PreviewDress {
  view: PreviewView;
  /** A `ClimateId`, or empty for the package exactly as authored. */
  climateId: string;
  season: SeasonId;
  gear: boolean;
}

/** Apply a preview's climate preset to an isolated lot; an empty preset leaves it as authored. */
export function dressIsolateLot(lot: IsolateLot, dress: Pick<PreviewDress, 'climateId' | 'season'>): void {
  const climate = climateById(dress.climateId);
  if (!climate) return;
  Object.assign(lot.town, { climate, ...townSeasonState(dress.season, climate) });
  stampRegionalExterior(lot.town.buildings, climate, lot.town.seed);
  lot.town.visualRevision++;
}

export interface IsolatePreview {
  show(definition: Archetype, dress: PreviewDress): void;
  resize(): void;
  destroy(): void;
}

function viewSize(host: HTMLElement): { width: number; height: number } {
  const width = Math.max(320, Math.floor(host.clientWidth) || 640);
  const height = Math.max(240, Math.floor(host.clientHeight) || 480);
  return { width, height };
}

function fitRenderer(app: Application, width: number, height: number): void {
  if (app.renderer.width !== width || app.renderer.height !== height) app.renderer.resize(width, height);
}

export async function bootIsolatePreview(host: HTMLElement): Promise<IsolatePreview> {
  const size = viewSize(host);
  const app = new Application();
  await app.init({
    width: size.width,
    height: size.height,
    resolution: 1,
    antialias: false,
    autoStart: false,
    background: 0x30362e,
    preference: 'webgl',
  });
  host.replaceChildren(app.canvas);
  const renderer = new WorldRenderer();
  app.stage.addChild(renderer.root);
  const particles = new ParticlePool();
  let current: { definition: Archetype; dress: PreviewDress } | undefined;

  function renderCurrent(): void {
    if (!current) return;
    const { width, height } = viewSize(host);
    fitRenderer(app, width, height);
    const lot = instantiateIsolateDefinition(current.definition);
    dressIsolateLot(lot, current.dress);
    particles.ownerAt = lot.town.debrisOwnerAt;
    particles.reseed(4517);
    Object.assign(renderer.debug, defaultDebugView(), { reveal: current.dress.view === 'cutaway', gear: current.dress.gear });
    frameIsolateLot(renderer, lot.camera, width, height);
    renderer.invalidate();
    renderer.layout(width, height, 0, 0);
    renderer.debug.vehicles = false;
    renderer.draw(lot.town, lot.dozer, particles, [], 10, false);
    app.render();
  }

  return {
    show(definition, dress) {
      current = { definition, dress };
      renderCurrent();
    },
    resize() { renderCurrent(); },
    destroy() {
      current = undefined;
      app.destroy(true);
      host.replaceChildren();
    },
  };
}
