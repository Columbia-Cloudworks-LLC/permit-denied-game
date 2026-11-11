// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TITLE } from '../game/constants';
import { MENU_LABELS as L } from '../game/menuLabels';
import { OperatorMenu, type MenuActions } from './operatorMenu';
import { resetSharedCountyProgress, sharedCountyProgress, type ProgressStore } from '../game/countyProgress';
import { countyWeather } from '../world/counties';
import { loadOverworld } from '../game/overworldLoader';
import { resetAtlasCache, schematicAtlas } from '../world/atlas';

let parent: HTMLElement;
let actions: { [K in keyof MenuActions]-?: ReturnType<typeof vi.fn> };
let menu: OperatorMenu;
const running = { session: 'challenge', season: 'winter', effects: 'reduced', regionId: 'US-MI', countyIndex: 3, weather: 'fog', mapSeed: 42 } as const;
const heading = () => menu.root.querySelector('#operator-heading')!.textContent;
const button = (selector: string) => menu.root.querySelector<HTMLButtonElement>(selector)!;
const key = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
/** The overworld chunk and atlas load on demand; let the imports, fetch and continuation run. */
const settle = async () => {
  await loadOverworld();
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0));
};
const openMap = async () => {
  button('[data-menu-action="open-map"]').click();
  await settle();
};
/** Map shapes are SVG paths, which have no click(); dispatch the event the browser would. */
const tap = (selector: string) => {
  const el = menu.root.querySelector(selector);
  if (!el) throw new Error(`No map target ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};
const region = (id: string) => `.atlas-macro [data-region-id="${id}"]`;
const county = (index: number) => `.atlas-sheet [data-county-index="${index}"]`;
const go = () => [...menu.root.querySelectorAll<HTMLButtonElement>('.atlas-go')].at(-1)!;
/** Single-click a region, then Go to it. */
const openRegion = (id: string) => {
  tap(region(id));
  go().click();
};
/** Press a season key on the world atlas. */
const season = (id: string) => button(`.atlas-macro [data-pick="season"][data-value="${id}"]`).click();
/** Press Time Challenge or Sandbox on the open state sheet. */
const mode = (kind: 'challenge' | 'sandbox') => button(`.atlas-sheet [data-pick="mode"][data-value="${kind}"]`).click();
const pressed = (pick: string) => [...menu.root.querySelectorAll<HTMLElement>(`[data-pick="${pick}"][aria-pressed="true"]`)].map(el => el.dataset.value);
const select = (id: string, value: string) => {
  const el = menu.root.querySelector<HTMLSelectElement>(`#${id}`)!;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

afterEach(() => {
  // Close the menu so a test that ends on the title page stops its intro timers before teardown.
  menu.show(null);
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetAtlasCache();
  // No network in unit tests: the atlas falls back to the schematic map.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  localStorage.clear();
  resetSharedCountyProgress();
  document.body.innerHTML = '<div id="game-root"><canvas tabindex="0"></canvas></div><div id="host"></div>';
  parent = document.querySelector<HTMLElement>('#host')!;
  actions = {
    page: vi.fn(), resume: vi.fn(), start: vi.fn(), mapSeed: vi.fn(() => 1234), restart: vi.fn(), debug: vi.fn(), title: vi.fn(), mute: vi.fn(),
    click: vi.fn(), unlockSound: vi.fn(() => Promise.resolve()), titleSound: vi.fn(), pwaUpdate: vi.fn(), homeYard: vi.fn(), clearProgress: vi.fn(),
  };
  menu = new OperatorMenu(parent, actions);
});

it('opens the atlas straight from Play, with the season keys on the map and nothing selected', async () => {
  menu.show('title');
  expect(menu.root.hidden).toBe(false);
  expect(heading()).toBe(TITLE);
  // No setup page: Play is the button that opens the map.
  expect(menu.root.querySelector('[data-nav="dispatch"]')).toBeNull();
  expect(menu.root.querySelector('#dispatch-mode')).toBeNull();
  await openMap();
  expect(actions.click).toHaveBeenCalled();
  expect(heading()).toBe('North America');
  expect(menu.root.classList.contains('map-open')).toBe(true);
  expect(menu.root.querySelectorAll('.overworld-map [data-region-id]')).toHaveLength(63);
  // The season is chosen on the atlas itself; the mode waits for a state sheet.
  expect([...menu.root.querySelectorAll<HTMLElement>('.atlas-macro [data-pick="season"]')].map(el => el.dataset.value)).toEqual(['spring', 'summer', 'autumn', 'winter']);
  expect(pressed('season')).toEqual(['summer']);
  season('winter');
  expect(pressed('season')).toEqual(['winter']);
  expect(menu.root.querySelector('.atlas-macro [data-pick="mode"]')).toBeNull();
  // The searchable sidebar is gone; the map is the picker.
  expect(menu.root.querySelector('#region-search')).toBeNull();
  expect(menu.root.querySelector('.region-list')).toBeNull();
  expect(go().disabled).toBe(true);
  expect(go().textContent).toBe('Select a State or Province');
  expect(menu.root.querySelector('.county-badges')).toBeNull();
  expect(menu.root.querySelector('#county-weather')).toBeNull();
  expect(menu.root.querySelectorAll('.atlas-zoom [data-zoom]')).toHaveLength(3);
  expect(actions.start).not.toHaveBeenCalled();
  // Back from the atlas returns to the title page.
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe(TITLE);
});

it('single-click selects a region and shows its seven county badges; Go opens the state sheet over the map', async () => {
  const progress = sharedCountyProgress();
  progress.markCleared('US-IL', 2);
  progress.markCleared('US-IL', 5);
  menu.show('title');
  await openMap();
  tap(region('US-IL'));
  expect(heading()).toBe('North America');
  expect(menu.root.querySelector(region('US-IL'))!.getAttribute('aria-pressed')).toBe('true');
  // The pick is circled in grease pencil: a fresh loop scrawled around the region, not a trace of its outline.
  const loop = menu.root.querySelector('.atlas-macro .atlas-selection')!;
  expect(loop.hasAttribute('hidden')).toBe(false);
  expect(loop.classList.contains('draw')).toBe(true);
  expect(loop.getAttribute('d')).toMatch(/^M[\d.-]+ [\d.-]+C/);
  expect(loop.getAttribute('d')).not.toBe(menu.root.querySelector(region('US-IL'))!.getAttribute('d'));
  // Hovering lays the highlighter over the region under the pointer.
  menu.root.querySelector(region('US-OH'))!.dispatchEvent(new Event('pointerover', { bubbles: true }));
  const mark = menu.root.querySelector('.atlas-macro .atlas-hover')!;
  expect(mark.hasAttribute('hidden')).toBe(false);
  expect(mark.getAttribute('d')).toBe(menu.root.querySelector(region('US-OH'))!.getAttribute('d'));
  const badges = [...menu.root.querySelectorAll<HTMLElement>('[data-atlas-bar="macro"] [data-county-slot]')];
  expect(badges.map(b => b.dataset.countySlot)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  expect(badges.map(b => b.dataset.countyCompleted)).toEqual(['false', 'true', 'false', 'false', 'true', 'false', 'false']);
  expect(badges[6]!.classList.contains('capitol')).toBe(true);
  expect(badges[6]!.classList.contains('locked')).toBe(true);
  expect(badges[6]!.getAttribute('aria-label')).toContain("Springfield Capitol District — Governor's Mansion. Locked");
  expect(badges[1]!.getAttribute('aria-label')).toContain('Cleared');
  expect(go().disabled).toBe(false);
  expect(go().textContent).toBe('Go to Illinois');
  // Picking another region moves the selection.
  tap(region('CA-ON'));
  expect(go().textContent).toBe('Go to Ontario');
  expect(menu.root.querySelector(region('US-IL'))!.getAttribute('aria-pressed')).toBe('false');
  tap(region('US-IL'));
  go().click();
  expect(heading()).toBe('Illinois');
  expect(menu.root.querySelector('#atlas-sheet-title')!.textContent).toBe('Illinois — Capitol: Springfield');
  expect(menu.root.querySelector<HTMLElement>('.atlas-macro')!.inert).toBe(true);
  expect(menu.root.querySelectorAll('.atlas-sheet [data-county-index]')).toHaveLength(7);
  expect(menu.root.querySelector('#atlas-sheet-clip')).not.toBeNull();
  expect(menu.root.querySelector(county(2))!.getAttribute('data-county-completed')).toBe('true');
  expect(go().disabled).toBe(true);
  expect(go().textContent).toBe('Select a County');
  // Back closes the sheet and keeps the continental map and its selection.
  [...menu.root.querySelectorAll<HTMLButtonElement>('.atlas-sheet [data-nav="back"]')][0]!.click();
  expect(heading()).toBe('North America');
  expect(menu.root.querySelector('.atlas-sheet')).toBeNull();
  expect(menu.root.querySelector<HTMLElement>('.atlas-macro')!.inert).toBe(false);
  expect(go().textContent).toBe('Go to Illinois');
});

it('defaults to Time Challenge, switches mode on the state sheet, and deploys what is pressed', async () => {
  menu.show('title');
  await openMap();
  season('autumn');
  tap(region('US-IL'));
  go().click();
  await settle();
  expect(pressed('mode')).toEqual(['challenge']);
  expect(menu.root.querySelector('.atlas-sheet .map-chips')!.textContent).toContain('Autumn');
  // Time Challenge keeps the capitol locked until Counties 1–6 clear.
  tap(county(7));
  expect(go().disabled).toBe(true);
  expect(menu.root.querySelector(county(7))!.classList.contains('locked')).toBe(true);
  // Sandbox opens every county; the sheet redraws in place and keeps the pick.
  mode('sandbox');
  expect(pressed('mode')).toEqual(['sandbox']);
  expect(menu.root.querySelectorAll('.atlas-sheet')).toHaveLength(1);
  expect(menu.root.querySelector('.atlas-sheet')!.classList.contains('settled')).toBe(true);
  expect(menu.root.querySelector(county(7))!.classList.contains('locked')).toBe(false);
  expect(menu.root.querySelector(county(7))!.getAttribute('aria-pressed')).toBe('true');
  expect(go().disabled).toBe(false);
  expect([...menu.root.querySelectorAll('.county-card .county-facts dt')].map(dt => dt.textContent)).toEqual(['Landmark', 'Region', 'Watch for', 'Establishments']);
  go().click();
  expect(actions.start).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'sandbox', season: 'autumn', regionId: 'US-IL', countyIndex: 7 }));
  // The choice carries to the next sheet opened from this map.
  mode('challenge');
  tap(county(1));
  go().click();
  expect(actions.start).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'challenge', season: 'autumn', regionId: 'US-IL', countyIndex: 1 }));
});

it('unfolds each map from its other side: a hinged flap with the cover on its back', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  menu.show('title');
  await openMap();
  const paper = menu.root.querySelector('.atlas-macro > .atlas-paper')!;
  const flap = paper.querySelector<HTMLElement>(':scope > .atlas-flap')!;
  expect(paper.classList.contains('folding')).toBe(true);
  expect(flap.inert).toBe(true);
  expect(flap.querySelector('.atlas-flap-back')!.textContent).toContain('Official Road Atlas');
  expect(flap.querySelector('.atlas-flap-back img')!.getAttribute('src')).toBe('/atlas/globe.webp');
  // Its face is a copy of the map with nothing to click, focus or look up by id.
  expect(flap.querySelectorAll('.atlas-flap-front .atlas-region')).toHaveLength(63);
  expect(flap.querySelector('[id], [data-region-id], [data-pick], [tabindex]')).toBeNull();
  expect(menu.root.querySelectorAll('[data-region-id]')).toHaveLength(63);
  // Landing removes the flap and leaves the whole sheet as the real paper.
  flap.dispatchEvent(new Event('animationend'));
  expect(paper.querySelector('.atlas-flap')).toBeNull();
  expect(paper.classList.contains('folding')).toBe(false);
  // A state sheet arrives the same way, its back a plain title block; a mode change does not refold it.
  openRegion('US-OH');
  const sheetFlap = menu.root.querySelector('.atlas-sheet .atlas-flap')!;
  expect(sheetFlap.querySelector('.atlas-flap-back')!.textContent).toContain('Ohio');
  mode('sandbox');
  expect(menu.root.querySelector('.atlas-sheet .atlas-flap')).toBeNull();
});

it('draws the paper relief inside each map, so its creases pan and zoom with the map', async () => {
  menu.show('title');
  await openMap();
  const svg = menu.root.querySelector('.overworld-map')!;
  const relief = svg.querySelector(':scope > .atlas-relief')!;
  expect(relief.getAttribute('href')).toBe('/atlas/paper-atlas.webp');
  // It is the map's top layer, in map units: a viewBox change moves it with everything else.
  expect(svg.lastElementChild).toBe(relief);
  const before = svg.getAttribute('viewBox');
  button('.atlas-macro [data-zoom="in"]').click();
  expect(svg.getAttribute('viewBox')).not.toBe(before);
  expect(relief.getAttribute('width')).toBe(before!.split(' ')[2]);
  // No fixed texture layer is left on the paper for the map to slide under.
  expect(getComputedStyle(menu.root.querySelector('.atlas-paper')!, '::after').backgroundImage || 'none').toBe('none');
  openRegion('US-IL');
  const il = menu.root.querySelector('.county-map .atlas-relief')!.getAttribute('href');
  expect(il).toMatch(/^\/atlas\/paper-sheet-[ab]\.webp$/);
});

it('lays the maps flat at once when motion is reduced', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  menu.show('title');
  await openMap();
  expect(menu.root.querySelector('.atlas-flap')).toBeNull();
  expect(menu.root.querySelector('.atlas-paper.folding')).toBeNull();
});

it('circles the picked county and shows its facts as icon rows', async () => {
  menu.show('title');
  await openMap();
  tap(region('US-IL'));
  go().click();
  await settle();
  // Nothing picked yet: no card, and no circle.
  expect(menu.root.querySelector('.county-card')).toBeNull();
  expect(menu.root.querySelector('.atlas-sheet .atlas-selection')!.hasAttribute('hidden')).toBe(true);
  tap(county(2));
  const loop = menu.root.querySelector('.atlas-sheet .atlas-selection')!;
  expect(loop.hasAttribute('hidden')).toBe(false);
  expect(loop.getAttribute('d')).toMatch(/^M[\d.-]+ [\d.-]+C/);
  const facts = [...menu.root.querySelectorAll('.county-card .county-facts dt')].map(dt => dt.textContent);
  expect(facts).toEqual(['Objective', 'Earn', 'County clock', 'Region', 'Watch for', 'Establishments']);
  expect(menu.root.querySelectorAll('.county-card .county-facts dt svg')).toHaveLength(6);
  tap(county(4));
  expect(menu.root.querySelector('.atlas-sheet .atlas-selection')!.getAttribute('d')).not.toBe(loop.getAttribute('d'));
});

it('double-click opens a region, and double-click on an open county deploys it', async () => {
  menu.show('title');
  await openMap();
  tap(region('US-OH'));
  tap(region('US-OH'));
  expect(heading()).toBe('Ohio');
  tap(county(4));
  expect(actions.start).not.toHaveBeenCalled();
  expect(go().textContent).toBe('Go to Suburban County');
  expect(go().getAttribute('aria-label')).toBe('Go to Ohio Suburban County');
  tap(county(4));
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'challenge', regionId: 'US-OH', countyIndex: 4 }));
});

it('deploys a sandbox county with its rolled weather, and only the sheet changes weather', async () => {
  menu.show('title');
  await openMap();
  season('autumn');
  openRegion('US-TX');
  expect(heading()).toBe('Texas');
  mode('sandbox');
  expect(menu.root.querySelector('#county-weather')).toBeNull();
  tap(county(1));
  expect(menu.root.querySelector('#county-card-title')!.textContent).toBe('Texas Farmstead County');
  expect(go().textContent).toBe('Go to Farmstead County');
  tap(county(7));
  expect(menu.root.querySelector('#county-card-title')!.textContent).toBe("Austin Capitol District — Governor's Mansion");
  expect(go().textContent).toBe('Go to Austin');
  expect(go().disabled).toBe(false);
  expect(menu.root.querySelector('.atlas-bar [data-county-slot="7"]')).not.toBeNull();
  const rolled = menu.root.querySelector<HTMLSelectElement>('#county-weather')!.value;
  expect(rolled).toBe(countyWeather(1234, 'autumn', 'US-TX', 7));
  go().click();
  expect(actions.start).toHaveBeenLastCalledWith({ kind: 'sandbox', season: 'autumn', regionId: 'US-TX', countyIndex: 7, weather: rolled, effects: 'on', mapSeed: 1234 });
  select('county-weather', 'fog');
  select('county-effects', 'reduced');
  expect(document.activeElement?.id).toBe('county-weather');
  go().click();
  expect(actions.start).toHaveBeenLastCalledWith(expect.objectContaining({ countyIndex: 7, weather: 'fog', effects: 'reduced' }));
  // The cycle button steps to the next condition.
  button('[data-weather-cycle]').click();
  expect(menu.root.querySelector<HTMLSelectElement>('#county-weather')!.value).not.toBe('fog');
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('North America');
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe(TITLE);
});

it('locks the capitol in Time Challenge until Counties 1–6 are cleared', async () => {
  menu.show('title');
  await openMap();
  openRegion('CA-ON');
  expect(menu.root.querySelector(county(7))!.classList.contains('locked')).toBe(true);
  tap(county(7));
  expect(go().disabled).toBe(true);
  expect(menu.root.querySelector('#county-lock-note')!.textContent).toContain('Ontario');
  tap(county(7));
  go().click();
  expect(actions.start).not.toHaveBeenCalled();
  const progress = sharedCountyProgress();
  for (let index = 1; index <= 6; index++) progress.markCleared('CA-ON', index);
  key(menu.root, { key: 'Escape' });
  expect(menu.root.querySelector(region('CA-ON'))!.getAttribute('aria-label')).toContain('6 of 7');
  expect(menu.root.querySelectorAll('[data-atlas-bar="macro"] [data-county-completed="true"]')).toHaveLength(6);
  // Enter on the selected region opens it, like a double-click.
  key(menu.root.querySelector(region('CA-ON'))!, { key: 'Enter' });
  expect(heading()).toBe('Ontario');
  tap(county(7));
  go().click();
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'challenge', regionId: 'CA-ON', countyIndex: 7 }));
});

it('keeps same-session clears on the map when storage writes fail', async () => {
  const blocked: ProgressStore = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const progress = resetSharedCountyProgress(blocked);
  menu.show('title');
  await openMap();
  openRegion('US-GA');
  tap(county(7));
  expect(go().disabled).toBe(true);
  // The game clears 1–6 through the shared record while storage refuses every write.
  for (let index = 1; index <= 6; index++) progress.markCleared('US-GA', index);
  key(menu.root, { key: 'Escape' });
  expect(menu.root.querySelector(region('US-GA'))!.getAttribute('aria-label')).toContain('6 of 7');
  go().click();
  tap(county(7));
  expect(go().disabled).toBe(false);
});

it('keeps only the newest map request when Open Map is clicked again while the atlas loads', async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
  menu.show('title');
  await settle();
  button('[data-menu-action="open-map"]').click();
  button('[data-menu-action="open-map"]').click();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  release(new Response(JSON.stringify(schematicAtlas())));
  await settle();
  expect(heading()).toBe('North America');
  expect(actions.mapSeed).toHaveBeenCalledOnce();
  // The mounted map's pan/zoom still works: no late request destroyed it.
  const svg = menu.root.querySelector('.overworld-map')!;
  const before = svg.getAttribute('viewBox');
  button('.atlas-macro [data-zoom="in"]').click();
  expect(svg.getAttribute('viewBox')).not.toBe(before);
});

const yard = { session: 'challenge', season: 'summer', effects: 'on', home: true } as const;

it('keeps only the Dispatch map when it is asked for after a world map that is still loading', async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
  menu.show('pause', yard);
  button('[data-menu-action="world-map"]').click();
  button('[data-menu-action="open-map"]').click();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  release(new Response(JSON.stringify(schematicAtlas())));
  await settle();
  expect(heading()).toBe('North America');
  // A fresh map: nothing preselected, and the season is free to change.
  expect(menu.root.querySelector('[data-region-id][aria-pressed="true"]')).toBeNull();
  expect(menu.root.querySelector<HTMLButtonElement>('.atlas-macro [data-pick="season"][data-value="spring"]')!.disabled).toBe(false);
});

it('offers no New Game during a run, and Dispatch only from the Home Yard', async () => {
  menu.show('pause', running);
  // A run is replaced only by deploying another county from its own maps.
  expect(menu.root.querySelector('[data-menu-action="open-map"]')).toBeNull();
  expect(menu.root.textContent).not.toContain(L.newGame);
  menu.show(null);
  menu.show('pause', yard);
  expect(button('[data-menu-action="open-map"]').textContent).toBe('Dispatch');
  await openMap();
  openRegion('US-MI');
  tap(county(3));
  // Dispatching from the yard replaces nothing, so there is nothing to warn about.
  expect(menu.root.querySelector('#deploy-replace-note')).toBeNull();
  expect(menu.root.querySelector('[data-menu-action="resume"]')).toBeNull();
});

it('renders the fetched road atlas when it is available', async () => {
  const atlas = { ...schematicAtlas(), source: 'fixture', schematic: undefined };
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(atlas)))));
  menu.show('title');
  await openMap();
  expect(fetch).toHaveBeenCalledWith('/atlas/north-america-atlas.json');
  expect(menu.root.querySelector('.atlas-macro')!.classList.contains('schematic')).toBe(false);
  expect(menu.root.querySelectorAll('.overworld-map [data-region-id]')).toHaveLength(63);
});

it('pauses on the running setup and routes each action', () => {
  menu.show('pause', { session: 'challenge', season: 'spring', effects: 'off', regionId: 'US-IL' });
  expect(heading()).toBe('Paused');
  for (const action of ['resume', 'restart', 'debug', 'title', 'mute'] as const) {
    button(`[data-menu-action="${action}"]`).click();
    expect(actions[action]).toHaveBeenCalledOnce();
  }
  expect(menu.root.querySelector('.caution')).not.toBeNull();
});

/** Pause-menu map buttons load the chunk the same way Open Map does. */
const pauseMap = async (action: 'state-map' | 'world-map') => {
  button(`[data-menu-action="${action}"]`).click();
  await settle();
};

it('opens the state map over a paused run without ending it, and resumes from the running county', async () => {
  menu.show('pause', running);
  expect(button('[data-menu-action="state-map"]').textContent).toBe(L.stateMap);
  await pauseMap('state-map');
  expect(heading()).toBe('Michigan');
  expect(menu.root.querySelector('.atlas-sheet .map-chips')!.textContent).toContain('Winter');
  expect(pressed('mode')).toEqual(['challenge']);
  // The run's maps keep the run's season: the other season keys are locked.
  expect(pressed('season')).toEqual(['winter']);
  expect([...menu.root.querySelectorAll<HTMLButtonElement>('.atlas-macro [data-pick="season"]')].filter(key => key.disabled).map(key => key.dataset.value)).toEqual(['spring', 'summer', 'autumn']);
  expect(menu.root.querySelector(county(3))!.classList.contains('current')).toBe(true);
  expect(menu.root.querySelector(county(3))!.classList.contains('selected')).toBe(true);
  expect(menu.root.querySelector<HTMLSelectElement>('#county-weather')!.value).toBe('fog');
  expect(go().textContent).toBe('Resume Works County');
  expect(actions.start).not.toHaveBeenCalled();
  expect(actions.title).not.toHaveBeenCalled();
  go().click();
  expect(actions.resume).toHaveBeenCalledOnce();
  expect(actions.start).not.toHaveBeenCalled();
});

it('browses the world map from pause, warns before replacing the run, and steps back to the pause menu', async () => {
  menu.show('pause', running);
  await pauseMap('world-map');
  expect(heading()).toBe('North America');
  expect(menu.root.querySelector(region('US-MI'))!.getAttribute('aria-pressed')).toBe('true');
  openRegion('US-OH');
  tap(county(1));
  expect(menu.root.querySelector('#deploy-replace-note')!.textContent).toMatch(/ends your current county run/);
  expect(menu.root.querySelector('[data-menu-action="resume"]')).toBeNull();
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('North America');
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('Paused');
  expect(actions.resume).not.toHaveBeenCalled();
  await pauseMap('world-map');
  openRegion('US-OH');
  tap(county(2));
  go().click();
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'challenge', season: 'winter', regionId: 'US-OH', countyIndex: 2, mapSeed: 42 }));
});

it('offers Resume and Restart only in the run\'s own mode', async () => {
  // A Sandbox run in the Michigan capitol, which Time Challenge keeps locked until 1–6 clear.
  menu.show('pause', { ...running, session: 'sandbox', countyIndex: 7 });
  await pauseMap('state-map');
  expect(pressed('mode')).toEqual(['sandbox']);
  expect(go().textContent).toMatch(/^Resume /);
  expect(menu.root.querySelector('.county-card [data-menu-action="deploy"]')!.textContent).toBe('Restart County 7');
  mode('challenge');
  // The run's county is now a locked Time Challenge county: no Resume, no Restart that does nothing.
  expect(menu.root.querySelector(county(7))!.classList.contains('current')).toBe(true);
  expect(go().textContent).not.toMatch(/^Resume /);
  expect(go().disabled).toBe(true);
  expect(menu.root.querySelector('.county-card [data-menu-action="deploy"]')).toBeNull();
  expect(menu.root.querySelector('#county-lock-note')).not.toBeNull();
  tap(county(7));
  tap(county(7));
  expect(actions.resume).not.toHaveBeenCalled();
  expect(actions.start).not.toHaveBeenCalled();
  // An open county in the other mode deploys fresh, with the replace warning.
  tap(county(2));
  expect(go().textContent).toMatch(/^Go to /);
  expect(menu.root.querySelector('#deploy-replace-note')).not.toBeNull();
  // Back in the run's mode, Resume returns.
  mode('sandbox');
  tap(county(7));
  expect(go().textContent).toMatch(/^Resume /);
  go().click();
  expect(actions.resume).toHaveBeenCalledOnce();
});

it('restarts the running county from its card with the chosen weather', async () => {
  menu.show('pause', running);
  await pauseMap('state-map');
  select('county-weather', 'clear');
  button('.county-card [data-menu-action="deploy"]').click();
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ regionId: 'US-MI', countyIndex: 3, weather: 'clear', effects: 'reduced' }));
});

it('keeps the run season on the run maps: the other season keys do nothing', async () => {
  menu.show('pause', running);
  await pauseMap('world-map');
  season('spring');
  expect(pressed('season')).toEqual(['winter']);
  go().click();
  await settle();
  tap(county(7));
  expect(go().disabled).toBe(true);
  tap(county(3));
  button('.county-card [data-menu-action="deploy"]').click();
  expect(actions.start).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'challenge', season: 'winter', effects: 'reduced', regionId: 'US-MI', countyIndex: 3, weather: 'fog' }));
});

it('slides the open atlas up under a state sheet opened straight from pause', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  menu.show('pause', running);
  await pauseMap('state-map');
  // No second unfold underneath: the atlas arrives open, and only the sheet has a flap.
  expect(menu.root.querySelector('.atlas-macro')!.classList.contains('risen')).toBe(true);
  expect(menu.root.querySelector('.atlas-macro .atlas-flap')).toBeNull();
  expect(menu.root.querySelector('.atlas-sheet')!.classList.contains('late')).toBe(true);
  expect(menu.root.querySelector('.atlas-sheet .atlas-flap')).not.toBeNull();
  // From the world map, the atlas unfolds as usual.
  menu.show(null);
  menu.show('pause', running);
  await pauseMap('world-map');
  expect(menu.root.querySelector('.atlas-macro')!.classList.contains('risen')).toBe(false);
  expect(menu.root.querySelector('.atlas-macro .atlas-flap')).not.toBeNull();
});

it('sweeps the maps away for a loading card, then starts the county once it has painted', async () => {
  vi.useFakeTimers();
  try {
    menu.show('title');
    button('[data-menu-action="open-map"]').click();
    await vi.runAllTimersAsync();
    openRegion('US-OH');
    tap(county(2));
    // Give the atlas a size, as it has in a browser: the departure only plays where it can be seen.
    const atlas = menu.root.querySelector<HTMLElement>('.atlas')!;
    Object.defineProperty(atlas, 'clientWidth', { value: 1280 });
    go().click();
    expect(atlas.classList.contains('leaving')).toBe(true);
    const card = atlas.querySelector('.atlas-splash')!;
    expect(card.getAttribute('role')).toBe('status');
    expect(card.querySelector('h2')!.textContent).toBe('Ohio Highway County');
    expect(card.textContent).toContain('Time Challenge');
    // The level build can hold the page, so it waits for the card to be on screen.
    expect(actions.start).not.toHaveBeenCalled();
    // Nothing on the departing maps answers: no second deploy, no Back.
    go().click();
    key(menu.root, { key: 'Escape' });
    expect(heading()).toBe('Ohio');
    await vi.advanceTimersByTimeAsync(500);
    expect(actions.start).toHaveBeenCalledOnce();
    expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'challenge', regionId: 'US-OH', countyIndex: 2 }));
    // If the level never takes over, the maps come back rather than strand the card.
    await vi.advanceTimersByTimeAsync(20000);
    expect(atlas.classList.contains('leaving')).toBe(false);
    expect(atlas.querySelector('.atlas-splash')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('clears progress only from the main menu, and only after a confirmation that says what goes', () => {
  menu.show('pause', running);
  expect(menu.root.querySelector('[data-nav="reset"]')).toBeNull();
  menu.show(null);
  menu.show('title');
  button('[data-nav="reset"]').click();
  expect(heading()).toBe('Clear Progress');
  expect(actions.clearProgress).not.toHaveBeenCalled();
  const text = menu.root.querySelector('.menu-body')!.textContent!;
  expect(text).toMatch(/cannot be undone/);
  expect(text).toMatch(/Every county you have cleared/);
  expect(text).toMatch(/banked cash, Heavy Shop upgrades/);
  // Backing out, by button or Escape, erases nothing.
  button('.reset-actions [data-nav="back"]').click();
  expect(heading()).toBe(TITLE);
  button('[data-nav="reset"]').click();
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe(TITLE);
  expect(actions.clearProgress).not.toHaveBeenCalled();
  button('[data-nav="reset"]').click();
  button('[data-menu-action="clear-progress"]').click();
  expect(actions.clearProgress).toHaveBeenCalledOnce();
  expect(menu.root.querySelector('[role="status"]')!.textContent).toMatch(/Progress cleared/);
  expect(menu.root.querySelector('[data-menu-action="clear-progress"]')).toBeNull();
});

it('offers only the world map when the paused run is not an overworld county', () => {
  menu.show('pause', { session: 'sandbox' });
  expect(menu.root.querySelector('[data-menu-action="state-map"]')).toBeNull();
  expect(menu.root.querySelector('[data-menu-action="world-map"]')).not.toBeNull();
});

it('walks the info pages, and Escape steps back before it resumes', async () => {
  menu.show('pause', { session: 'sandbox' });
  button('[data-nav="controls"]').click();
  expect(heading()).toBe(L.controls);
  // Controls and About text load on first visit, not at startup.
  await vi.waitFor(() => expect(menu.root.querySelector('.control-list')).not.toBeNull());
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('Paused');
  expect(actions.resume).not.toHaveBeenCalled();
  button('[data-nav="about"]').click();
  expect(heading()).toBe(L.about);
  // The licence notices load with the page rather than at startup.
  await vi.waitFor(() => expect(menu.root.querySelector('pre')!.textContent!.length).toBeGreaterThan(0));
  expect(menu.root.querySelector<HTMLElement>('.nameplate')!.hidden).toBe(false);
  button('[data-nav="back"]').click();
  button('[data-nav="equipment"]').click();
  expect(menu.root.querySelector('.menu-permit-host')).not.toBeNull();
  expect(actions.page).toHaveBeenLastCalledWith('equipment', expect.any(HTMLElement));
  key(menu.root, { key: 'Escape' });
  key(menu.root, { key: 'Escape' });
  expect(actions.resume).toHaveBeenCalledOnce();
});

it('toggles sound with M except while typing in a field', async () => {
  menu.show('title', { session: 'sandbox' });
  key(menu.root, { key: 'm' });
  expect(actions.mute).toHaveBeenCalledOnce();
  key(menu.root, { key: 'M', repeat: true });
  expect(actions.mute).toHaveBeenCalledOnce();
  await openMap();
  openRegion('US-OH');
  tap(county(1));
  key(menu.root.querySelector('#county-weather')!, { key: 'm' });
  expect(actions.mute).toHaveBeenCalledOnce();
});

it('reflects mute state and the pending build on the home page', () => {
  menu.show('pause', { session: 'sandbox' });
  menu.syncMuted(true);
  expect(button('[data-menu-action="mute"]').getAttribute('aria-label')).toBe(L.soundOff);
  expect(button('[data-menu-action="mute"]').getAttribute('aria-pressed')).toBe('false');
  menu.setUpdateAvailable(true);
  button('[data-menu-action="pwa-update"]').click();
  expect(actions.pwaUpdate).toHaveBeenCalledOnce();
  menu.setUpdateAvailable(false);
  expect(menu.root.querySelector('.pwa-update')).toBeNull();
});

it('hands focus back to the game when it closes', () => {
  menu.show('pause', { session: 'sandbox' });
  menu.show(null);
  expect(menu.root.hidden).toBe(true);
  expect(actions.page).toHaveBeenLastCalledWith(null);
  expect(document.activeElement).toBe(document.querySelector('#game-root canvas'));
});

it('wraps Tab within the visible controls, and parks focus on the heading when none are laid out', () => {
  menu.show('pause', { session: 'sandbox' });
  const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  const controls = [...menu.root.querySelectorAll<HTMLElement>('button, a[href], input, select, summary, [tabindex="0"]')]
    .filter(el => !el.closest('[hidden]') && !el.matches(':disabled'));
  const first = controls[0]!, last = controls.at(-1)!;
  last.focus();
  key(last, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  key(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  rects.mockReturnValue([] as unknown as DOMRectList);
  key(last, { key: 'Tab' });
  expect(document.activeElement).toBe(menu.root.querySelector('#operator-heading'));
  rects.mockRestore();
});

it('reaches the Home Yard from the world and state maps, not from the title page', async () => {
  menu.show('title');
  expect(menu.root.querySelector('[data-menu-action="home-yard"]')).toBeNull();
  await openMap();
  button('.atlas-back [data-menu-action="home-yard"]').click();
  expect(actions.homeYard).toHaveBeenCalledTimes(1);
  tap(region('US-IL'));
  go().click();
  await settle();
  button('.atlas-sheet ~ * [data-menu-action="home-yard"], [data-atlas-bar="sheet"] [data-menu-action="home-yard"]').click();
  expect(actions.homeYard).toHaveBeenCalledTimes(2);
});

it('offers Bail Out to Yard from the pause menu during a run', () => {
  menu.show('pause', running);
  button('[data-menu-action="home-yard"]').click();
  expect(actions.homeYard).toHaveBeenCalledTimes(1);
});
