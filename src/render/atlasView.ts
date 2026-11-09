import type { CountyProgress } from '../game/countyProgress';
import type { SessionKind } from '../game/session';
import type { AtlasData } from '../world/atlas';
import { REGIONS, regionById } from '../world/regions';
import type { WeatherDetail } from '../world/season';
import { PanZoom } from './atlasPanZoom';
import {
  atlasMacroHtml,
  atlasSheetHtml,
  countyCardHtml,
  macroBarHtml,
  regionLabel,
  sheetBarHtml,
  sheetViewBox,
  type CountyCardRun,
  type CountyViewState,
  type MapChips,
} from './overworldMap';

/** Everything the atlas draws from, handed over by the operator menu on each update. */
export interface AtlasState {
  atlas: AtlasData;
  progress: CountyProgress;
  kind: SessionKind;
  chips: MapChips;
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

  constructor(private readonly body: HTMLElement) {}

  /** Forget the view and zoom for a fresh map visit. */
  reset(): void {
    this.macroZoom?.destroy();
    this.sheetZoom?.destroy();
    this.macroZoom = this.sheetZoom = undefined;
  }

  show(sheet: boolean, s: AtlasState): void {
    if (!this.body.querySelector('.atlas-macro')) this.renderMacro(s);
    else if (s.regionId) this.selectRegion(s);
    this.sheetZoom?.destroy();
    this.sheetZoom = undefined;
    this.body.querySelector('.atlas-sheet')?.remove();
    if (sheet) this.renderSheet(s);
    this.body.querySelector('.atlas')!.classList.toggle('sheet-open', sheet);
    // The dimmed continental map stays mounted under the sheet but out of reach.
    this.body.querySelector<HTMLElement>('.atlas-macro')!.inert = sheet;
  }

  private renderMacro(s: AtlasState): void {
    const kept = this.macroZoom?.view;
    this.macroZoom?.destroy();
    this.body.innerHTML = `<div class="atlas">${atlasMacroHtml(s.atlas, REGIONS, s.progress, s.kind, s.chips, regionById(s.regionId))}</div>`;
    const viewport = this.body.querySelector<HTMLElement>('[data-pan-zoom="macro"]')!;
    const [x, y, w, h] = s.atlas.viewBox;
    this.macroZoom = new PanZoom(viewport, viewport.querySelector('svg')!, { x, y, w, h }, kept);
  }

  private renderSheet(s: AtlasState): void {
    const region = regionById(s.regionId)!;
    this.body.querySelector('.atlas')!.insertAdjacentHTML('beforeend', atlasSheetHtml(s.atlas, region, REGIONS, s.progress, s.view, s.chips, s.effects, s.run));
    const viewport = this.body.querySelector<HTMLElement>('[data-pan-zoom="sheet"]')!;
    const [x, y, w, h] = sheetViewBox(s.atlas.regions[region.id]!);
    this.sheetZoom = new PanZoom(viewport, viewport.querySelector('svg')!, { x, y, w, h });
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
    for (const outline of this.body.querySelectorAll('.atlas-selection, .atlas-selection-shadow')) {
      outline.setAttribute('d', s.atlas.regions[id]!.d);
      outline.removeAttribute('hidden');
    }
    const bar = this.body.querySelector('[data-atlas-bar="macro"]');
    if (bar) bar.innerHTML = macroBarHtml(regionById(id), s.progress, s.kind);
  }

  selectCounty(s: AtlasState): void {
    for (const path of this.body.querySelectorAll<SVGElement>('.atlas-sheet [data-county-index]')) {
      const on = Number(path.dataset.countyIndex) === s.view.selected;
      path.classList.toggle('selected', on);
      path.setAttribute('aria-pressed', String(on));
    }
    this.refreshSheet(s);
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
