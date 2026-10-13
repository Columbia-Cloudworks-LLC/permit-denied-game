// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { TITLE } from '../game/constants';
import { MENU_LABELS as L } from '../game/menuLabels';
import { OperatorMenu, type MenuActions } from './operatorMenu';

let parent: HTMLElement;
let actions: { [K in keyof MenuActions]-?: ReturnType<typeof vi.fn> };
let menu: OperatorMenu;
const heading = () => menu.root.querySelector('#operator-heading')!.textContent;
const button = (selector: string) => menu.root.querySelector<HTMLButtonElement>(selector)!;
const key = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const select = (id: string, value: string) => {
  const el = menu.root.querySelector<HTMLSelectElement>(`#${id}`)!;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  document.body.innerHTML = '<div id="game-root"><canvas tabindex="0"></canvas></div><div id="host"></div>';
  parent = document.querySelector<HTMLElement>('#host')!;
  actions = {
    page: vi.fn(), resume: vi.fn(), start: vi.fn(), restart: vi.fn(), debug: vi.fn(), title: vi.fn(), mute: vi.fn(),
    click: vi.fn(), unlockSound: vi.fn(() => Promise.resolve()), titleSound: vi.fn(), pwaUpdate: vi.fn(),
  };
  menu = new OperatorMenu(parent, actions);
});

it('opens on the title page and starts a new game with the chosen setup', () => {
  menu.show('title', 'challenge', 'classic');
  expect(menu.root.hidden).toBe(false);
  expect(heading()).toBe(TITLE);
  button('[data-nav="dispatch"]').click();
  expect(heading()).toBe(L.newGame);
  expect(actions.click).toHaveBeenCalled();
  select('dispatch-mode', 'challenge');
  expect(menu.root.querySelector<HTMLElement>('#dispatch-season-field')!.hidden).toBe(true);
  expect(menu.root.querySelector('#season-note')!.textContent).toBe('One randomly chosen season lasts for the whole campaign.');
  select('dispatch-mode', 'sandbox');
  expect(menu.root.querySelector<HTMLElement>('#dispatch-season-field')!.hidden).toBe(false);
  select('dispatch-lot', 'village');
  select('dispatch-season', 'winter');
  select('dispatch-effects', 'reduced');
  button('[data-menu-action="start"]').click();
  expect(actions.start).toHaveBeenCalledWith('sandbox', 'village', 'winter', 'reduced');
});

it('pauses on the running setup and routes each action', () => {
  menu.show('pause', 'challenge', 'classic', false, 'suburb', 'spring', 'off');
  expect(heading()).toBe('Paused');
  for (const action of ['resume', 'restart', 'debug', 'title', 'mute'] as const) {
    button(`[data-menu-action="${action}"]`).click();
    expect(actions[action]).toHaveBeenCalledOnce();
  }
  button('[data-nav="dispatch"]').click();
  expect(menu.root.querySelector<HTMLSelectElement>('#dispatch-mode')!.value).toBe('challenge');
  expect(menu.root.querySelector<HTMLSelectElement>('#dispatch-lot')!.value).toBe('suburb');
  expect(menu.root.querySelector<HTMLSelectElement>('#dispatch-effects')!.value).toBe('off');
  expect(menu.root.querySelector('.caution')).not.toBeNull();
});

it('walks the info pages, and Escape steps back before it resumes', () => {
  menu.show('pause', 'sandbox', 'classic');
  button('[data-nav="controls"]').click();
  expect(heading()).toBe(L.controls);
  expect(menu.root.querySelector('.control-list')).not.toBeNull();
  key(menu.root, { key: 'Escape' });
  expect(heading()).toBe('Paused');
  expect(actions.resume).not.toHaveBeenCalled();
  button('[data-nav="about"]').click();
  expect(heading()).toBe(L.about);
  expect(menu.root.querySelector('pre')!.textContent!.length).toBeGreaterThan(0);
  expect(menu.root.querySelector<HTMLElement>('.nameplate')!.hidden).toBe(false);
  button('[data-nav="back"]').click();
  button('[data-nav="equipment"]').click();
  expect(menu.root.querySelector('.menu-permit-host')).not.toBeNull();
  expect(actions.page).toHaveBeenLastCalledWith('equipment', expect.any(HTMLElement));
  key(menu.root, { key: 'Escape' });
  key(menu.root, { key: 'Escape' });
  expect(actions.resume).toHaveBeenCalledOnce();
});

it('toggles sound with M except while typing in a field', () => {
  menu.show('title', 'sandbox', 'classic');
  key(menu.root, { key: 'm' });
  expect(actions.mute).toHaveBeenCalledOnce();
  key(menu.root, { key: 'M', repeat: true });
  expect(actions.mute).toHaveBeenCalledOnce();
  button('[data-nav="dispatch"]').click();
  key(menu.root.querySelector('#dispatch-mode')!, { key: 'm' });
  expect(actions.mute).toHaveBeenCalledOnce();
});

it('reflects mute state and the pending build on the home page', () => {
  menu.show('pause', 'sandbox', 'classic');
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
  menu.show('pause', 'sandbox', 'classic');
  menu.show(null, 'sandbox', 'classic');
  expect(menu.root.hidden).toBe(true);
  expect(actions.page).toHaveBeenLastCalledWith(null);
  expect(document.activeElement).toBe(document.querySelector('#game-root canvas'));
});

it('wraps Tab within the visible controls, and parks focus on the heading when none are laid out', () => {
  menu.show('pause', 'sandbox', 'classic');
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
