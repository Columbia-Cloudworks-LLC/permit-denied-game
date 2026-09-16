import { Application } from 'pixi.js';
import { ParticlePool } from '../fx/particles';
import { WorldRenderer } from '../render/WorldRenderer';
import { defaultDebugView } from '../debug/view';
import { frameIsolateLot, instantiateIsolateDefinition } from '../debug/isolateLot';
import type { Archetype } from '../world/archetypes';

export type PreviewView = 'intact' | 'cutaway';

export interface IsolatePreview {
  show(definition: Archetype, view: PreviewView): void;
  resize(): void;
  destroy(): void;
}

function viewSize(host: HTMLElement): { width: number; height: number } {
  const width = Math.max(320, Math.floor(host.clientWidth) || 640);
  const height = Math.max(240, Math.floor(host.clientHeight) || 480);
  return { width, height };
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
  let current: { definition: Archetype; view: PreviewView } | undefined;

  function renderCurrent(): void {
    if (!current) return;
    const { width, height } = viewSize(host);
    if (app.renderer.width !== width || app.renderer.height !== height) app.renderer.resize(width, height);
    const lot = instantiateIsolateDefinition(current.definition);
    particles.ownerAt = lot.town.debrisOwnerAt;
    particles.reseed(4517);
    Object.assign(renderer.debug, defaultDebugView(), current.view === 'cutaway' ? { reveal: true } : {});
    frameIsolateLot(renderer, lot.camera, width, height);
    renderer.invalidate();
    renderer.layout(width, height, 0, 0);
    renderer.debug.vehicles = false;
    renderer.draw(lot.town, lot.dozer, particles, [], 10, false);
    app.render();
  }

  return {
    show(definition, view) {
      current = { definition, view };
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
