// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CASH_TARGET, COPY, TITLE } from '../game/constants';
import { MENU_LABELS as L } from '../game/menuLabels';
import './domTestShims';
import { Hud, type CampaignHud, type HudState } from './hud';


function state(overrides: Partial<HudState> = {}): HudState {
  return {
    hasYard: false, upgradeModifiers: { bladeMul: 1, engineMul: 1, pushMul: 1 },
    cash: 0, resubmitted: false, timeLeft: 300, elapsed: 0, session: 'challenge', district: 'classic',
    bladeDown: false, muted: false, heat: 0, track: 0, overlay: 'none', death: null, won: false,
    ...overrides,
  };
}

function campaign(overrides: Partial<CampaignHud> = {}): CampaignHud {
  return {
    levelIndex: 2, levelName: 'Borough', landmarkName: 'Grain Elevator', dollarTarget: 12000,
    levelEarned: 4500.7, campaignEarned: 20000, landmarkProgress: 0.42, landmarkReady: false,
    dollarsReady: false, briefing: 'Clear the elevator.\nMind the rail spur.', victory: false, complete: false,
    levelId: 'city-borough', buildingCount: 40, timeLimit: 420,
    ...overrides,
  };
}

let root: HTMLElement;
let hud: Hud;
const text = (selector: string) => root.querySelector(selector)!.textContent;
const hidden = (selector: string) => root.querySelector<HTMLElement>(selector)!.hidden;
const click = (selector: string) => root.querySelector<HTMLElement>(selector)!.click();
const key = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

beforeEach(() => {
  document.body.innerHTML = '<div id="game-root"><canvas></canvas></div><div id="hud"></div>';
  root = document.querySelector<HTMLElement>('#hud')!;
  hud = new Hud(root);
});

describe('play readouts', () => {
  it('shows the challenge target, county clock and the most urgent advisory', () => {
    hud.render(state({ cash: 1234, heat: 80, track: 90 }));
    expect(text('#cash-target')).toBe(`Target $${CASH_TARGET.toLocaleString('en-US')}`);
    expect(hidden('#cash-target')).toBe(false);
    expect(text('#hud-clock-label')).toBe('County Clock');
    expect(text('#hud-advisory')).toBe('HIGH HEAT · RELEASE BLADE');
    expect(root.querySelector('#gauge-heat')!.classList.contains('warning')).toBe(true);
    expect(root.querySelector('#gauge-heat')!.classList.contains('critical')).toBe(false);
    expect(root.querySelector('#gauge-track')!.classList.contains('critical')).toBe(true);
    expect(root.querySelector('#gauge-heat')!.getAttribute('aria-valuenow')).toBe('80');
    expect(text('#mobile-cash')).toBe('$1,234');
    expect(text('#mobile-target')).toBe(`of $${CASH_TARGET.toLocaleString('en-US')}`);
    expect(text('#mobile-clock-label')).toBe('Remaining');
    expect(text('#mobile-warning')).toBe('HIGH HEAT · RELEASE BLADE');

    hud.render(state({ track: 70 }));
    expect(text('#hud-advisory')).toBe('TRACK STRESS · BACK OFF');
    hud.render(state({ pileResistance: 0.6 }));
    expect(text('#hud-advisory')).toBe('DENSE RUBBLE · CLEAR A PATH');
    hud.render(state({ fieldNotice: 'Crops trampled' }));
    expect(text('#hud-advisory')).toBe('Crops trampled');
    hud.render(state());
    expect(hidden('#hud-advisory')).toBe(true);
    expect(hidden('#mobile-warning')).toBe(true);
  });

  it('runs an elapsed clock in sandbox and on a demolition job', () => {
    hud.render(state({ session: 'sandbox' }));
    expect(text('#hud-clock-label')).toBe('Elapsed');
    expect(hidden('#cash-target')).toBe(true);
    expect(text('#mobile-target')).toBe('Cash');
    const job = { progress: 0.5, remaining: 0.5, instruction: 'Knock down the brick block.', paid: false, payout: 1200 };
    hud.render(state({ job }));
    expect(hidden('#hud-job')).toBe(false);
    expect(text('#hud-job')).toBe(`${L.brick} · 50%\nKnock down the brick block.\nRemove 90% of the structure.`);
    expect(text('#mobile-job')).toBe('Demolition · 50% / 90%');
    hud.render(state({ job: { ...job, paid: true } }));
    expect(text('#hud-job')).toBe('Demolition Complete · +$1200');
    expect(text('#mobile-job')).toBe('Demolition complete · +$1200');
  });

  it('labels the blade and repaints upgrade multipliers only when they change', () => {
    hud.render(state({ bladeDown: true, upgradeModifiers: { bladeMul: 1.25, engineMul: 1, pushMul: 1 } }));
    expect(text('#hud-blade')).toBe(COPY.bladeDown);
    const blade = root.querySelector('[data-modifier="bladeMul"]')!;
    expect(blade.textContent).toBe('1.25×');
    expect(blade.getAttribute('aria-label')).toBe('Blade damage: 1.25 times');
    hud.render(state({ upgradeModifiers: { bladeMul: 1.5, engineMul: 1, pushMul: 1 } }));
    expect(text('#hud-blade')).toBe(COPY.bladeUp);
    expect(blade.textContent).toBe('1.50×');
  });

  it('tracks campaign money and the landmark', () => {
    hud.render(state({ campaign: campaign(), season: 'autumn' }));
    expect(hidden('#hud-campaign')).toBe(false);
    expect(text('#hud-level-name')).toBe('2/7 Borough · Autumn');
    expect(text('#hud-campaign-dollars')).toBe('$4,500');
    expect(text('#hud-landmark')).toBe('Grain Elevator 42%');
    expect(text('#cash-target')).toBe('of $12,000 ');
    expect(text('#mobile-target')).toBe('2/7 of $12,000');
    expect(text('#mobile-job')).toBe('Grain Elevator 42%');
    hud.render(state({ campaign: campaign({ landmarkReady: true, landmarkProgress: 1, dollarsReady: true }) }));
    expect(text('#hud-landmark')).toBe('Grain Elevator 100% DOWN');
    expect(text('#mobile-target')).toBe('2/7 CASH DONE');
    expect(text('#cash-target')).toBe('of $12,000 DONE');
    expect(hidden('[data-act="newseed"]')).toBe(true);
  });
});

describe('overlays', () => {
  it('opens the title menu over an inert game', () => {
    hud.render(state({ overlay: 'title' }));
    expect(root.classList.contains('modal-open')).toBe(true);
    expect(document.querySelector<HTMLElement>('#game-root')!.inert).toBe(true);
    expect(text('#operator-heading')).toBe(TITLE);
    hud.render(state());
    expect(root.classList.contains('modal-open')).toBe(false);
    expect(document.querySelector<HTMLElement>('#game-root')!.inert).toBe(false);
  });

  it('offers upgrades by click and by number key', () => {
    const onChoice = vi.fn(), onClick = vi.fn();
    Object.assign(hud, { onChoice, onClick });
    hud.render(state({ overlay: 'upgrade' }));
    expect(text('#result-heading')).toBe('Upgrade');
    click('#hud-panel [data-up="push"]');
    expect(onChoice).toHaveBeenLastCalledWith('push');
    expect(onClick).toHaveBeenCalled();
    key(root.querySelector('#hud-overlay')!, { key: '2' });
    expect(onChoice).toHaveBeenLastCalledWith('engine');
    key(root.querySelector('#hud-overlay')!, { key: '1', repeat: true });
    expect(onChoice).toHaveBeenCalledTimes(2);
  });

  it('keeps Tab inside the results panel and restarts on R', () => {
    const onRestart = vi.fn(), onTitle = vi.fn();
    Object.assign(hud, { onRestart, onTitle });
    hud.render(state({ overlay: 'results', death: COPY.engineCooked, cash: 950.4, timeLeft: 200 }));
    expect(text('#result-heading')).toBe(COPY.engineCooked);
    expect(text('#hud-panel p')).toContain('CASH $950');
    const [restart, title] = [...root.querySelectorAll<HTMLButtonElement>('#hud-panel button')];
    expect(restart!.dataset.act).toBe('restart');
    title!.focus();
    key(title!, { key: 'Tab' });
    expect(document.activeElement).toBe(restart);
    key(restart!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(title);
    key(root.querySelector('#hud-overlay')!, { key: 'R' });
    expect(onRestart).toHaveBeenCalledOnce();
    title!.click();
    expect(onTitle).toHaveBeenCalledOnce();
  });

  it('steps a campaign forward from the briefing and results cards', () => {
    const onBeginLevel = vi.fn(), onNextLevel = vi.fn(), onRetryLevel = vi.fn(), onNewCampaign = vi.fn();
    Object.assign(hud, { onBeginLevel, onNextLevel, onRetryLevel, onNewCampaign });
    hud.render(state({ overlay: 'briefing', campaign: campaign() }));
    expect(root.querySelector('.campaign-briefing')!.innerHTML).toBe('Clear the elevator.<br>Mind the rail spur.');
    click('#hud-panel [data-act="begin"]');
    expect(onBeginLevel).toHaveBeenCalledOnce();

    hud.render(state({ overlay: 'results', won: true, campaign: campaign({ landmarkReady: true }) }));
    expect(text('#result-heading')).toBe('LEVEL CLEARED');
    expect(text('#hud-panel p')).toBe('Borough · $4,500 / $12,000Grain Elevator DOWN');
    click('#hud-panel [data-act="next"]');
    expect(onNextLevel).toHaveBeenCalledOnce();

    hud.render(state({ overlay: 'results', death: 'COUNTY CLOCK', campaign: campaign() }));
    expect(text('#hud-panel p')).toBe('Borough · $4,500 / $12,000Grain Elevator 42%');
    click('#hud-panel [data-act="retry"]');
    expect(onRetryLevel).toHaveBeenCalledOnce();

    hud.render(state({ overlay: 'results', won: true, campaign: campaign({ victory: true }) }));
    expect(text('#result-heading')).toBe('COUNTY CLOSED');
    expect(text('#hud-panel p')).toContain('Campaign total $20,000');
    click('#hud-panel [data-act="new-campaign"]');
    expect(onNewCampaign).toHaveBeenCalledOnce();
  });

  it('keeps a shown card in place until its outcome changes', () => {
    hud.render(state({ overlay: 'results', death: COPY.engineCooked }));
    const first = root.querySelector('#hud-panel button');
    hud.render(state({ overlay: 'results', death: COPY.engineCooked }));
    expect(root.querySelector('#hud-panel button')).toBe(first);
    hud.render(state({ overlay: 'results', death: COPY.trackThrown }));
    expect(root.querySelector('#hud-panel button')).not.toBe(first);
    expect(text('#result-heading')).toBe(COPY.trackThrown);
  });
});

describe('debug binder', () => {
  it('opens, folds, and closes, reporting each change', () => {
    const onDebugOpen = vi.fn();
    Object.assign(hud, { onDebugOpen });
    click('#debug-toggle');
    expect(hidden('#debug-panel')).toBe(false);
    expect(root.querySelector('#debug-toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(hud.debugDockWidth).toBeGreaterThan(0);
    click('#debug-collapse');
    expect(text('#debug-collapse')).toBe('Unfold');
    expect(root.querySelector('#debug-collapse')!.getAttribute('aria-label')).toBe('Expand binder');
    expect(hud.debugDockWidth).toBe(0);
    click('#debug-collapse');
    expect(text('#debug-collapse')).toBe('Fold');
    expect(onDebugOpen).toHaveBeenCalled();
    expect(hud.closeDebug()).toBe(true);
    expect(hidden('#debug-panel')).toBe(true);
    expect(hud.closeDebug()).toBe(false);
  });

  it('hides behind a modal overlay and returns after it', () => {
    hud.openDebug();
    hud.render(state({ overlay: 'pause' }));
    expect(hidden('#debug-panel')).toBe(true);
    hud.render(state());
    expect(hidden('#debug-panel')).toBe(false);
  });

  it('moves between tabs with the arrow, Home and End keys', () => {
    hud.openDebug();
    const tab = (name: string) => root.querySelector<HTMLButtonElement>(`[data-debug-tab="${name}"]`)!;
    key(tab('assets'), { key: 'ArrowRight' });
    expect(tab('inspector').getAttribute('aria-selected')).toBe('true');
    expect(hidden('#debug-inspector')).toBe(false);
    expect(hidden('#debug-assets')).toBe(true);
    key(tab('inspector'), { key: 'End' });
    expect(tab('session').getAttribute('aria-selected')).toBe('true');
    key(tab('session'), { key: 'ArrowRight' });
    expect(tab('assets').getAttribute('aria-selected')).toBe('true');
    key(tab('assets'), { key: 'ArrowLeft' });
    expect(tab('session').getAttribute('aria-selected')).toBe('true');
    key(tab('session'), { key: 'Home' });
    expect(tab('assets').getAttribute('aria-selected')).toBe('true');
    key(tab('assets'), { key: 'x' });
    expect(tab('assets').getAttribute('aria-selected')).toBe('true');
  });

  it('routes session bar buttons and marks the running mode and level', () => {
    const onSession = vi.fn(), onCampaignLevel = vi.fn(), onJob = vi.fn(), onNewSeed = vi.fn(), onChoice = vi.fn();
    Object.assign(hud, { onSession, onCampaignLevel, onJob, onNewSeed, onChoice });
    hud.render(state({ session: 'challenge', campaign: campaign({ levelId: 'county' }) }));
    const challenge = root.querySelector<HTMLButtonElement>('[data-session="challenge"]')!;
    expect(challenge.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[data-session="sandbox"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('[data-level="county"]')!.classList.contains('on')).toBe(true);
    click('[data-session="sandbox"]');
    expect(onSession).toHaveBeenCalledWith('sandbox');
    click('[data-level="county"]');
    expect(onCampaignLevel).toHaveBeenCalledWith('county');
    click('#hud-session [data-act="job"]');
    expect(onJob).toHaveBeenCalledOnce();
    click('#hud-session [data-act="newseed"]');
    expect(onNewSeed).toHaveBeenCalledOnce();
    click('#hud-session [data-up="engine"]');
    expect(onChoice).toHaveBeenCalledWith('engine');
  });

  it('names the test yard reset after what is loaded', () => {
    hud.render(state({ hasYard: true, focusedTest: true, testMapName: 'Asset test' }));
    expect(hidden('#debug-reset-test')).toBe(false);
    expect(text('#debug-reset-test')).toBe('Reset Test');
    expect(text('#hud-session [data-act="restart"]')).toBe('Reset Test');
    hud.render(state({ hasYard: true }));
    expect(text('#debug-reset-test')).toBe('Reset Entire Yard');
    hud.render(state());
    expect(text('#hud-session [data-act="restart"]')).toBe(L.restart);
  });
});
