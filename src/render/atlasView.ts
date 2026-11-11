import type { CountyProgress } from '../game/countyProgress';
import type { SessionKind } from '../game/session';
import type { AtlasData } from '../world/atlas';
import { REGIONS, regionById } from '../world/regions';
import type { SeasonId, WeatherConditionId, WeatherDetail } from '../world/season';
import { PanZoom, type View } from './atlasPanZoom';
import {
  atlasMacroHtml,
  atlasSheetHtml,
  coverHtml,
  countyCardHtml,
  countyScribble,
  macroBarHtml,
  regionLabel,
  regionScribble,
  sheetBarHtml,
  sheetViewBox,
  splashHtml,
  type CountyCardRun,
  type CountyViewState,
} from './overworldMap';

/** Everything the atlas draws from, handed over by the operator menu on each update. */
export interface AtlasState {
  atlas: AtlasData;
  progress: CountyProgress;
  kind: SessionKind;
  season: SeasonId;
  /** A paused run's maps keep the run's season. */
  seasonLocked: boolean;
  effects: WeatherDetail;
  regionId?: string;
  view: CountyViewState;
  run: CountyCardRun;
}

/**
 * The atlas DOM inside the menu body: mounts the continental map once, lays the state sheet over
 * it, and applies selections in place so pan/zoom and double-click targets survive. Lives in the
 * overworld chunk so none of it weighs on startup.
 */
export class AtlasView {
  private macroZoom?: PanZoom;
  private sheetZoom?: PanZoom;
  /** Refit each map's paper when its window changes shape. */
  private readonly resizes = new Map<Element, ResizeObserver>();

  constructor(private readonly body: HTMLElement) {
    for (const type of ['pointerover', 'focusin'] as const) body.addEventListener(type, e => this.hover(e.target));
    body.addEventListener('pointerleave', () => this.hover(null));
    body.addEventListener('focusout', () => this.hover(null));
  }

  /** Forget the view and zoom for a fresh map visit. */
  reset(): void {
    this.macroZoom?.destroy();
    this.sheetZoom?.destroy();
    this.macroZoom = this.sheetZoom = undefined;
    for (const observer of this.resizes.values()) observer.disconnect();
    this.resizes.clear();
  }

  show(sheet: boolean, s: AtlasState): void {
    // Straight to a state sheet (Pause → State Map): the atlas under it has no reason to unfold
    // first. It slides up already open, and the sheet unfolds over it a beat later.
    const both = sheet && !this.body.querySelector('.atlas-macro');
    if (!this.body.querySelector('.atlas-macro')) this.renderMacro(s, both);
    else if (s.regionId) this.selectRegion(s);
    this.sheetZoom?.destroy();
    this.sheetZoom = undefined;
    this.body.querySelector('.atlas-sheet')?.remove();
    if (sheet) this.renderSheet(s, undefined, both);
    this.body.querySelector('.atlas')!.classList.toggle('sheet-open', sheet);
    // The dimmed continental map stays mounted under the sheet but out of reach.
    this.body.querySelector<HTMLElement>('.atlas-macro')!.inert = sheet;
  }

  /** `open`: arrive already unfolded, sliding up from the bottom edge. */
  private renderMacro(s: AtlasState, open = false): void {
    const kept = this.macroZoom?.view;
    this.macroZoom?.destroy();
    this.body.innerHTML = `<div class="atlas">${atlasMacroHtml(s.atlas, REGIONS, s.progress, { season: s.season, locked: s.seasonLocked }, regionById(s.regionId))}</div>`;
    const viewport = this.body.querySelector<HTMLElement>('[data-pan-zoom="macro"]')!;
    const [x, y, w, h] = s.atlas.viewBox;
    this.macroZoom = new PanZoom(viewport, viewport.querySelector('svg')!, { x, y, w, h }, kept);
    this.watchPaper(viewport, { x, y, w, h });
    this.fitPens();
    if (open) this.body.querySelector('.atlas-macro')!.classList.add('risen');
    else this.unfold('.atlas-macro', coverHtml());
  }

  /** `kept`: redraw a sheet that is already open (a mode change) where it lies, without unfolding it again. */
  private renderSheet(s: AtlasState, kept?: PanZoom['view'], late = false): void {
    const region = regionById(s.regionId)!;
    this.body.querySelector('.atlas')!.insertAdjacentHTML('beforeend', atlasSheetHtml(s.atlas, region, REGIONS, s.progress, s.view, s.effects, s.run));
    const viewport = this.body.querySelector<HTMLElement>('[data-pan-zoom="sheet"]')!;
    const [x, y, w, h] = sheetViewBox(s.atlas.regions[region.id]!);
    this.sheetZoom = new PanZoom(viewport, viewport.querySelector('svg')!, { x, y, w, h }, kept);
    this.watchPaper(viewport, { x, y, w, h });
    this.fitPens();
    if (late) this.body.querySelector('.atlas-sheet')!.classList.add('late');
    if (kept) this.body.querySelector('.atlas-sheet')!.classList.add('settled');
    else this.unfold('.atlas-sheet', coverHtml(region));
    this.syncSelects(s);
  }

  /** Outline, aria state, label and bottom bar for the selected region; the map itself is kept. */
  selectRegion(s: AtlasState): void {
    const id = s.regionId!;
    for (const path of this.body.querySelectorAll<SVGElement>('.atlas-macro [data-region-id]')) {
      const on = path.dataset.regionId === id;
      path.classList.toggle('selected', on);
      path.setAttribute('aria-pressed', String(on));
      if (!on) continue;
      // Clears can land while the map is mounted (a paused run), so refresh this region's label.
      const cleared = s.progress.clearedCount(id);
      const label = regionLabel(regionById(id)!, s.progress);
      path.setAttribute('aria-label', label);
      const title = path.querySelector('title');
      if (title) title.textContent = label;
      path.classList.toggle('started', cleared > 0 && cleared < 7);
      path.classList.toggle('done', cleared === 7);
    }
    this.scribble('.atlas-macro', regionScribble(s.atlas, id));
    const bar = this.body.querySelector('[data-atlas-bar="macro"]');
    if (bar) bar.innerHTML = macroBarHtml(regionById(id), s.progress);
  }

  selectCounty(s: AtlasState): void {
    for (const path of this.body.querySelectorAll<SVGElement>('.atlas-sheet [data-county-index]')) {
      const on = Number(path.dataset.countyIndex) === s.view.selected;
      path.classList.toggle('selected', on);
      path.setAttribute('aria-pressed', String(on));
    }
    const shape = s.atlas.regions[s.regionId ?? ''];
    if (shape && s.view.selected) this.scribble('.atlas-sheet', countyScribble(shape, s.view.selected, s.regionId!));
    this.refreshSheet(s);
  }

  /** Fit the paper to this map now, and again whenever its window is resized. */
  private watchPaper(viewport: HTMLElement, base: View): void {
    for (const [seen, observer] of this.resizes) {
      if (seen.isConnected) continue;
      observer.disconnect();
      this.resizes.delete(seen);
    }
    this.fitPaper(viewport, base);
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => this.fitPaper(viewport, base));
    observer.observe(viewport);
    this.resizes.set(viewport, observer);
  }

  /**
   * Stretch the paper relief over exactly what the unzoomed map shows. The map's box is letterboxed
   * into the window (`xMidYMid meet`), so the visible sheet is that box widened or heightened to
   * the window's shape; the relief covers all of it, and since pan and zoom never leave the box,
   * no view can reach past the paper's edge.
   */
  private fitPaper(viewport: HTMLElement, base: View): void {
    const relief = viewport.querySelector('.atlas-relief');
    const width = viewport.clientWidth, height = viewport.clientHeight;
    if (!relief || !width || !height) return;
    const w = Math.max(base.w, base.h * width / height), h = Math.max(base.h, base.w * height / width);
    const x = base.x - (w - base.w) / 2, y = base.y - (h - base.h) / 2;
    const flip = relief.getAttribute('data-flip') ?? '';
    const r = (v: number) => String(Math.round(v * 1000) / 1000);
    // The photographs are landscape. On a tall window the sheet is turned on its side rather than
    // squeezed, so its wrinkles keep their shape; then it is mirrored about its own centre.
    const turned = height > width * 1.15;
    const cx = x + w / 2, cy = y + h / 2, iw = turned ? h : w, ih = turned ? w : h;
    for (const [name, value] of [['x', cx - iw / 2], ['y', cy - ih / 2], ['width', iw], ['height', ih]] as const) relief.setAttribute(name, r(value));
    const sx = flip.includes('x') ? -1 : 1, sy = flip.includes('y') ? -1 : 1;
    relief.setAttribute('transform', `translate(${r(cx)} ${r(cy)}) rotate(${turned ? 90 : 0}) scale(${sx} ${sy}) translate(${r(-cx)} ${r(-cy)})`);
  }

  /**
   * Open a folded map the way paper opens. The sheet arrives folded in half with its other side
   * up; the top half then swings over on the centre fold, its back (the cover) turning away as
   * its face (that half of the map) comes round. The swinging half is a throwaway copy of the
   * paper, stripped of ids and controls, on a flap that is removed once it lands on the real one.
   */
  private unfold(scope: string, cover: string): void {
    const paper = this.body.querySelector<HTMLElement>(`${scope} > .atlas-paper`);
    if (!paper || typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const page = paper.cloneNode(true) as HTMLElement;
    for (const el of [page, ...page.querySelectorAll('*')]) {
      for (const attr of [...el.attributes]) if (/^(id$|data-|aria-|role$|tabindex$|for$)/.test(attr.name)) el.removeAttribute(attr.name);
    }
    const flap = document.createElement('div');
    flap.className = 'atlas-flap';
    flap.setAttribute('aria-hidden', 'true');
    flap.inert = true;
    flap.innerHTML = `<div class="atlas-flap-back">${cover}</div><div class="atlas-flap-front"></div>`;
    flap.lastElementChild!.append(page);
    paper.append(flap);
    paper.classList.add('folding');
    const land = () => { flap.remove(); paper.classList.remove('folding'); };
    flap.addEventListener('animationend', e => { if (e.target === flap) land(); });
    // No animation events without a layout engine, and none if the tab is hidden: land regardless.
    setTimeout(land, 2200);
  }

  /**
   * A county is chosen: sweep the maps off the desk and leave the loading card until the level is
   * ready. `then` runs once the card has had time to paint (the level build can hold the page), or
   * at once where nothing is laid out. Returns false if a departure is already under way.
   */
  depart(s: AtlasState, weather: WeatherConditionId, then: () => void): boolean {
    const atlas = this.body.querySelector('.atlas');
    const region = regionById(s.regionId);
    // Nothing laid out (no layout engine, or the menu is not on screen): nothing to sweep or paint.
    if (!atlas || !region || !s.view.selected || !(atlas as HTMLElement).clientWidth) { then(); return true; }
    if (atlas.classList.contains('leaving')) return false;
    atlas.classList.add('leaving');
    atlas.insertAdjacentHTML('beforeend', splashHtml(region, s.view.selected, s.kind, s.season, weather));
    for (const part of atlas.querySelectorAll<HTMLElement>('.atlas-macro, .atlas-sheet')) part.inert = true;
    // If the level never takes over (a failed load), put the maps back rather than strand the card.
    const restore = () => {
      if (!atlas.isConnected) return;
      atlas.classList.remove('leaving');
      atlas.querySelector('.atlas-splash')?.remove();
      atlas.querySelector<HTMLElement>('.atlas-sheet')?.removeAttribute('inert');
      if (!atlas.querySelector('.atlas-sheet')) atlas.querySelector<HTMLElement>('.atlas-macro')?.removeAttribute('inert');
    };
    setTimeout(restore, 20000);
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(then, still ? 60 : 460);
    return true;
  }

  /** Press the season key that is in force. */
  setSeason(s: AtlasState): void {
    for (const key of this.body.querySelectorAll<HTMLElement>('.atlas-macro [data-pick="season"]')) key.setAttribute('aria-pressed', String(key.dataset.value === s.season));
  }

  /** Redraw the open sheet for the other mode, keeping its zoom, and put focus back on the mode switch. */
  setMode(s: AtlasState): void {
    const kept = this.sheetZoom?.view;
    this.sheetZoom?.destroy();
    this.body.querySelector('.atlas-sheet')?.remove();
    this.renderSheet(s, kept);
    this.body.querySelector<HTMLElement>('.atlas-sheet [data-pick="mode"][aria-pressed="true"]')?.focus();
  }

  private fitPens(): void {
    for (const loop of this.body.querySelectorAll('.atlas-selection:not([hidden])')) this.penWidth(loop);
  }

  /** Scrawl the selection circle afresh: a new node restarts its draw-on animation. */
  private scribble(scope: string, d: string): void {
    const old = this.body.querySelector(`${scope} .atlas-selection`);
    if (!old) return;
    const next = old.cloneNode(false) as Element;
    next.setAttribute('d', d);
    next.removeAttribute('hidden');
    next.classList.add('draw');
    old.replaceWith(next);
    this.penWidth(next);
  }

  /**
   * Keep the pencil line about as thick on a phone as on a desktop. Its width is in map units
   * (so the draw-on dash animation stays exact), sized here from how large the map is on screen.
   */
  private penWidth(loop: Element): void {
    const svg = loop.closest('svg') as SVGSVGElement | null;
    const scale = svg?.getScreenCTM?.()?.a;
    if (!svg || !scale) return;
    const labelScale = Number(svg.style.getPropertyValue('--label-scale')) || 1;
    (loop as SVGElement).style.setProperty('--sw', String(Math.round(3.4 / scale / labelScale * 1000) / 1000));
  }

  /** Lay the highlighter over whichever region or county is under the pointer or holds focus. */
  private hover(target: EventTarget | null): void {
    const shape = target instanceof Element ? target.closest('[data-region-id], [data-county-index]') : null;
    for (const mark of this.body.querySelectorAll('.atlas-hover')) {
      const mine = !!shape && mark.closest('svg') === shape.closest('svg');
      if (mine) mark.setAttribute('d', shape.getAttribute('d')!);
      mark.toggleAttribute('hidden', !mine);
      mark.classList.toggle('locked', mine && shape.classList.contains('locked'));
    }
  }

  /** Redraw the sheet's card and bar in place, then put focus back on the control that changed it. */
  refreshSheet(s: AtlasState, focusSelector?: string): void {
    const region = regionById(s.regionId);
    if (!region) return;
    const card = this.body.querySelector('.atlas-sheet .county-card-host');
    if (card) card.innerHTML = countyCardHtml(region, s.progress, s.view, s.run);
    const bar = this.body.querySelector('[data-atlas-bar="sheet"]');
    if (bar) bar.innerHTML = sheetBarHtml(region, s.progress, s.view, s.run, s.effects);
    this.syncSelects(s);
    if (focusSelector) this.body.querySelector<HTMLElement>(focusSelector)?.focus();
  }

  /** Set the selects from state; markup `selected` alone is not honored by every DOM. */
  private syncSelects(s: AtlasState): void {
    const weather = this.body.querySelector<HTMLSelectElement>('#county-weather');
    if (weather && s.view.selected) weather.value = s.view.weather(s.view.selected);
    const effects = this.body.querySelector<HTMLSelectElement>('#county-effects');
    if (effects) effects.value = s.effects;
  }
}
