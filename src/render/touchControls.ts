import { stickAxes } from '../game/input';

export interface TouchState { throttle: number; steer: number; blade: boolean }
interface TouchCallbacks {
  change: (state: TouchState) => void;
  release: () => void;
  interact: () => void;
  restart: () => void;
  resize: () => void;
}

/** DOM controls keep pointer ownership out of the simulation and keyboard state. */
export class TouchControls {
  readonly root = document.createElement('div');
  readonly menu = document.createElement('section');
  menuOpen = false;
  enabled = false;
  private blocked = false;
  private state: TouchState = { throttle: 0, steer: 0, blade: false };
  private stickPointer: number | null = null;
  private bladePointer: number | null = null;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private blade: HTMLButtonElement;
  private menuButton: HTMLButtonElement;
  private abort = new AbortController();
  private moved: { element: HTMLElement; marker: Comment }[] = [];
  private coarse = window.matchMedia('(any-pointer: coarse)');
  private forced = new URLSearchParams(location.search).get('controls') === '1';
  private lastLayout = '';
  private observer: ResizeObserver;

  constructor(private hud: HTMLElement, private callbacks: TouchCallbacks) {
    this.root.id = 'touch-controls';
    this.root.innerHTML = `<div class="touch-deck">
      <div class="touch-drive"><div class="touch-stick" role="group" aria-label="Drive: up forward, down reverse, left and right steer"><span class="stick-guide">▲<br>◀ &nbsp; ▶<br>▼</span><span class="stick-knob"></span></div><span>DRIVE / STEER</span></div>
      <div class="touch-action"><button type="button" class="touch-blade" aria-label="Hold powered blade">POWER<br>BLADE</button><span>HOLD TO POWER</span></div>
    </div>`;
    this.menu.id = 'touch-menu';
    this.menu.setAttribute('aria-label', 'Game menu');
    this.menu.hidden = true;
    this.menu.innerHTML = '<strong>PAUSED</strong><button type="button" id="touch-menu-close">RESUME</button><button type="button" id="touch-restart">RESTART</button>';
    const actions = document.createElement('div');
    actions.className = 'touch-top-actions';
    actions.innerHTML = '<button type="button" id="touch-menu-toggle" aria-expanded="false" aria-controls="touch-menu">MENU</button>';
    this.root.append(actions);
    hud.append(this.root, this.menu);
    this.stick = this.root.querySelector('.touch-stick')!;
    this.knob = this.root.querySelector('.stick-knob')!;
    this.blade = this.root.querySelector('.touch-blade')!;
    this.menuButton = this.root.querySelector('#touch-menu-toggle')!;
    const signal = this.abort.signal;
    this.menuButton.addEventListener('click', () => this.setMenu(!this.menuOpen), { signal });
    this.menu.querySelector('button')!.addEventListener('click', () => { this.setMenu(false); this.menuButton.focus(); }, { signal });
    this.menu.querySelector('#touch-restart')!.addEventListener('click', () => { this.setMenu(false); callbacks.restart(); }, { signal });
    this.stick.addEventListener('pointerdown', e => {
      if (!this.available() || this.stickPointer !== null || e.button !== 0) return;
      e.preventDefault();
      callbacks.interact();
      this.stickPointer = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
      this.moveStick(e);
    }, { signal });
    this.stick.addEventListener('pointermove', e => { if (e.pointerId === this.stickPointer) this.moveStick(e); }, { signal });
    this.blade.addEventListener('pointerdown', e => {
      if (!this.available() || this.bladePointer !== null || e.button !== 0) return;
      e.preventDefault();
      callbacks.interact();
      this.bladePointer = e.pointerId;
      this.blade.setPointerCapture(e.pointerId);
      this.state.blade = true;
      this.emit();
    }, { signal });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.stick.addEventListener(event, e => {
        if (e.pointerId !== this.stickPointer) return;
        this.stickPointer = null;
        this.state.throttle = this.state.steer = 0;
        this.knob.style.transform = '';
        this.emit();
      }, { signal });
      this.blade.addEventListener(event, e => {
        if (e.pointerId !== this.bladePointer) return;
        this.bladePointer = null;
        this.state.blade = false;
        this.emit();
      }, { signal });
    }
    window.addEventListener('blur', () => this.reset(), { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); }, { signal });
    window.addEventListener('resize', () => { this.reset(); this.layout(); }, { signal });
    window.visualViewport?.addEventListener('resize', () => { this.reset(); this.layout(); }, { signal });
    this.coarse.addEventListener('change', () => this.layout(), { signal });
    hud.addEventListener('toggle', e => {
      if (e.target instanceof HTMLDetailsElement && e.target.open) this.reset();
    }, { capture: true, signal });
    window.addEventListener('keydown', e => {
      if (this.menuOpen && e.key === 'Escape' && this.hud.querySelector<HTMLElement>('#debug-panel')!.hidden) { e.preventDefault(); e.stopImmediatePropagation(); this.setMenu(false); }
    }, { capture: true, signal });
    this.observer = new ResizeObserver(() => callbacks.resize());
    this.observer.observe(document.querySelector('#game-root')!);
    this.layout();
  }

  private available(): boolean { return this.enabled && !this.blocked && !this.menuOpen; }

  private moveStick(e: PointerEvent): void {
    const rect = this.stick.getBoundingClientRect();
    const radius = rect.width / 2;
    const x = (e.clientX - rect.left - radius) / radius;
    const y = (e.clientY - rect.top - radius) / radius;
    const length = Math.max(1, Math.hypot(x, y));
    Object.assign(this.state, stickAxes(x / length, y / length));
    const travel = radius - 22;
    this.knob.style.transform = `translate(${x / length * travel}px, ${y / length * travel}px)`;
    this.emit();
  }

  private emit(): void {
    this.blade.classList.toggle('active', this.state.blade);
    this.callbacks.change({ ...this.state });
  }

  reset(): void {
    const stickPointer = this.stickPointer, bladePointer = this.bladePointer;
    this.stickPointer = this.bladePointer = null;
    if (stickPointer !== null && this.stick.hasPointerCapture(stickPointer)) this.stick.releasePointerCapture(stickPointer);
    if (bladePointer !== null && this.blade.hasPointerCapture(bladePointer)) this.blade.releasePointerCapture(bladePointer);
    this.state = { throttle: 0, steer: 0, blade: false };
    this.knob.style.transform = '';
    this.emit();
    this.callbacks.release();
  }

  setBlocked(blocked: boolean): void {
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    if (blocked) { this.setMenu(false); this.reset(); }
    this.root.querySelector<HTMLElement>('.touch-deck')!.inert = blocked;
    this.root.classList.toggle('blocked', blocked);
  }

  toggleMenu(): void { this.setMenu(!this.menuOpen); }

  private setMenu(open: boolean): void {
    this.reset();
    this.menuOpen = open;
    this.menu.hidden = !open;
    this.menuButton.setAttribute('aria-expanded', String(open));
    this.hud.classList.toggle('touch-menu-open', open);
    if (open) this.menu.querySelector<HTMLButtonElement>('button')!.focus();
  }

  private layout(): void {
    const enabled = this.forced || this.coarse.matches;
    const portrait = window.innerHeight > window.innerWidth;
    const layout = `${enabled}:${portrait}`;
    if (layout === this.lastLayout) return;
    this.lastLayout = layout;
    this.reset();
    if (!enabled || !this.enabled) this.setMenu(false);
    this.enabled = enabled;
    document.documentElement.classList.toggle('touch-ui', enabled);
    document.documentElement.classList.toggle('touch-portrait', enabled && portrait);
    this.root.hidden = !enabled;
    if (enabled && !this.moved.length) {
      for (const selector of ['#hud-mute', '#hud-session', '.debug-menu', '.yard-panel', '#hud-tower']) {
        const element = this.hud.querySelector<HTMLElement>(selector)!;
        const marker = document.createComment('desktop position');
        element.before(marker);
        this.moved.push({ element, marker });
        if (element instanceof HTMLDetailsElement) element.open = false;
        if (selector === '.debug-menu') this.root.querySelector('.touch-top-actions')!.prepend(element);
        else this.menu.append(element);
      }
    } else if (!enabled) {
      for (const { element, marker } of this.moved) { marker.replaceWith(element); }
      this.moved = [];
    }
  }

  destroy(): void {
    this.reset();
    this.abort.abort();
    this.observer.disconnect();
    for (const { element, marker } of this.moved) marker.replaceWith(element);
    this.root.remove();
    this.menu.remove();
    document.documentElement.classList.remove('touch-ui', 'touch-portrait');
  }
}
