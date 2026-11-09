import type { CountyProgress } from '../game/countyProgress';
import type { SessionKind } from '../game/session';
import { CAPITOL_COUNTY_INDEX, COUNTIES_PER_REGION, regionCounties, type CountyDef } from '../world/counties';
import { REGIONAL_FLAVORS } from '../world/regionalCatalog';
import { REGION_GRID, type RegionDef } from '../world/regions';
import {
  seasonLabel,
  WEATHER_CONDITIONS,
  WEATHER_DETAILS,
  weatherConditionLabel,
  type SeasonId,
  type WeatherConditionId,
  type WeatherDetail,
} from '../world/season';

/**
 * Overworld markup. The macro view is a tile cartogram (one square per region) and the micro
 * view is seven hexes: six counties around the capitol. Both are a few hundred bytes of inline
 * SVG; a searchable list beside each covers small East Coast states, phones, and screen readers.
 */

const TILE = 40;
const GAP = 4;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function progressLabel(region: RegionDef, progress: CountyProgress): string {
  return `${progress.clearedCount(region.id)}/${COUNTIES_PER_REGION}`;
}

export function overworldSvg(regions: readonly RegionDef[], progress: CountyProgress): string {
  const width = REGION_GRID.cols * TILE, height = REGION_GRID.rows * TILE;
  const tiles = regions.map(region => {
    const [col, row] = region.tile;
    const x = col * TILE + GAP / 2, y = row * TILE + GAP / 2, size = TILE - GAP;
    const cleared = progress.clearedCount(region.id);
    const bar = (size - 6) * (cleared / COUNTIES_PER_REGION);
    const label = `${region.name}, ${progressLabel(region, progress)} counties cleared`;
    return `<g class="region-tile ${region.country === 'CA' ? 'ca' : 'us'}${cleared === COUNTIES_PER_REGION ? ' done' : ''}" role="button" tabindex="0" data-region="${region.id}" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="4"/><text x="${x + size / 2}" y="${y + size / 2}">${region.postal}</text><rect class="bar" x="${x + 3}" y="${y + size - 6}" width="${bar.toFixed(1)}" height="3"/></g>`;
  }).join('');
  return `<svg class="overworld-map" viewBox="0 0 ${width} ${height}" role="group" aria-label="North America: 50 states and 13 provinces and territories">${tiles}</svg>`;
}

export function regionListHtml(regions: readonly RegionDef[], progress: CountyProgress): string {
  if (!regions.length) return '<p class="fine-print">No state or province matches.</p>';
  return regions.map(region =>
    `<button type="button" data-region="${region.id}"><span>${escapeHtml(region.name)}</span><span class="region-code">${region.id}</span><span class="region-progress">${progressLabel(region, progress)}</span></button>`,
  ).join('');
}

const HEX_R = 34;
const RING = HEX_R * Math.sqrt(3);
const CENTER = { x: 120, y: 112 };

function hexPoints(cx: number, cy: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    points.push(`${(cx + HEX_R * Math.cos(a)).toFixed(1)},${(cy + HEX_R * Math.sin(a)).toFixed(1)}`);
  }
  return points.join(' ');
}

/** County 7 sits in the middle; 1–6 ring it clockwise from the top. */
function hexCenter(index: number): { x: number; y: number } {
  if (index === CAPITOL_COUNTY_INDEX) return CENTER;
  const angle = -Math.PI / 2 + (Math.PI / 3) * (index - 1);
  return { x: CENTER.x + RING * Math.cos(angle), y: CENTER.y + RING * Math.sin(angle) };
}

export interface CountyViewState {
  kind: SessionKind;
  season: SeasonId;
  selected: number;
  /** The county being played under a paused run, if it is in this region. */
  current?: number;
  weather(index: number): WeatherConditionId;
}

function countyStatus(county: CountyDef, progress: CountyProgress, kind: SessionKind): 'cleared' | 'locked' | 'open' {
  if (progress.isCleared(county.regionId, county.index)) return 'cleared';
  return progress.isUnlocked(kind, county.regionId, county.index) ? 'open' : 'locked';
}

const STATUS_TEXT = { cleared: 'Cleared', locked: 'Locked', open: 'Open' } as const;

export function countySvg(region: RegionDef, progress: CountyProgress, view: CountyViewState): string {
  const hexes = regionCounties(region).map(county => {
    const { x, y } = hexCenter(county.index);
    const status = countyStatus(county, progress, view.kind);
    const label = `County ${county.index}: ${county.name}. ${STATUS_TEXT[status]}. ${weatherConditionLabel(view.season, view.weather(county.index))}.`;
    const mark = county.index === CAPITOL_COUNTY_INDEX ? '★' : String(county.index);
    return `<g class="county-hex ${status}${county.index === view.selected ? ' selected' : ''}${county.index === view.current ? ' current' : ''}" role="button" tabindex="0" data-county="${county.index}" aria-pressed="${county.index === view.selected}" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title><polygon points="${hexPoints(x, y)}"/><text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${mark}</text></g>`;
  }).join('');
  return `<svg class="county-map" viewBox="0 0 240 224" role="group" aria-label="${escapeHtml(region.name)} counties">${hexes}</svg>`;
}

export function countyListHtml(region: RegionDef, progress: CountyProgress, view: CountyViewState): string {
  return regionCounties(region).map(county => {
    const status = countyStatus(county, progress, view.kind);
    const here = county.index === view.current ? ' · Playing' : '';
    return `<button type="button" class="${status}" data-county="${county.index}" aria-pressed="${county.index === view.selected}"><span>${county.index}. ${escapeHtml(county.shortName)}</span><span class="county-status">${STATUS_TEXT[status]}${here}</span></button>`;
  }).join('');
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function deployControls(index: number, locked: boolean, run: CountyCardRun): string {
  const lock = locked ? ' disabled aria-describedby="county-lock-note"' : '';
  if (run.current) {
    return `<p class="fine-print county-current">You are playing this county. Resume keeps your run; Restart rebuilds it with the weather above.</p><button class="primary" data-menu-action="resume">Resume County ${index}</button><button data-menu-action="deploy" aria-describedby="deploy-replace-note">Restart County ${index}</button><p class="caution" id="deploy-replace-note">Restarting resets this county's cash, demolition, and upgrades.</p>`;
  }
  const note = run.replacing && !locked ? '<p class="caution" id="deploy-replace-note">Deploying ends your current county run. Resume from the pause menu to keep playing it.</p>' : '';
  const describe = run.replacing && !locked ? ' aria-describedby="deploy-replace-note"' : '';
  return `${note}<button class="primary" data-menu-action="deploy"${lock}${describe}>Deploy to County ${index}</button>`;
}

const DETAIL_LABELS: Record<WeatherDetail, string> = { on: 'On', reduced: 'Reduced', off: 'Off' };

/** The only place weather can change: the selected county, right before deploying. */
/** `current`: this card is the county being played. `replacing`: deploying would end a paused run. */
export interface CountyCardRun {
  current: boolean;
  replacing: boolean;
}

export function countyCardHtml(region: RegionDef, progress: CountyProgress, view: CountyViewState, effects: WeatherDetail, run: CountyCardRun = { current: false, replacing: false }): string {
  const county = regionCounties(region)[view.selected - 1]!;
  const status = countyStatus(county, progress, view.kind);
  const weather = view.weather(county.index);
  const level = county.level;
  const flavor = REGIONAL_FLAVORS[region.flavor];
  const signatures = [...flavor.signatures, ...county.archetype.signatures].map(spec => spec.label).slice(0, 3).join(', ');
  const weatherOptions = WEATHER_CONDITIONS.map(id => `<option value="${id}"${id === weather ? ' selected' : ''}>${weatherConditionLabel(view.season, id)}</option>`).join('');
  const effectOptions = WEATHER_DETAILS.map(id => `<option value="${id}"${id === effects ? ' selected' : ''}>${DETAIL_LABELS[id]}</option>`).join('');
  const challenge = view.kind === 'challenge'
    ? `<div><dt>Objective</dt><dd>Demolish ${escapeHtml(level.landmark.label)} and earn $${level.dollarTarget.toLocaleString('en-US')} in ${clock(level.timeLimit)}</dd></div>`
    : `<div><dt>Landmark</dt><dd>${escapeHtml(level.landmark.label)}</dd></div>`;
  const lockNote = status === 'locked'
    ? `<p class="caution" id="county-lock-note">Clear Counties 1–6 in ${escapeHtml(region.name)} to open the capitol.</p>`
    : '';
  return `<section class="county-card" aria-labelledby="county-card-title">
<h2 id="county-card-title">${escapeHtml(county.name)}</h2>
<dl class="credits-list county-facts">
<div><dt>County</dt><dd>${county.index}/7 · ${escapeHtml(county.archetype.label)} · ${STATUS_TEXT[status]}</dd></div>
${challenge}
<div><dt>Region</dt><dd>${escapeHtml(flavor.label)}. Watch for: ${escapeHtml(signatures)}</dd></div>
<div><dt>Season</dt><dd>${seasonLabel(view.season)} (locked)</dd></div>
</dl>
<div class="dispatch-fields"><label>Weather<select id="county-weather">${weatherOptions}</select></label><label>Weather effects<select id="county-effects">${effectOptions}</select></label></div>
${lockNote}${deployControls(county.index, status === 'locked', run)}
</section>`;
}
