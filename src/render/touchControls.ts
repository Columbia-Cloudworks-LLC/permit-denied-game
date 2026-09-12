import { stickAxes } from '../game/input';

export interface TouchState { throttle: number; steer: number; blade: boolean }
interface TouchCallbacks {
  change: (state: TouchState) => void;
  release: () => void;
  interact: () => void;
  resize: () => void;
}

/** DOM controls keep pointer ownership out of the simulation and keyboard state. */
export class TouchControls {
  readonly root = document.createElement('div');
  enabled = false;
  private blocked = false;
  private state: TouchState = { throttle: 0, steer: 0, blade: false };
  private stickPointer: number | null = null;
  private bladePointer: number | null = null;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private blade: HTMLButtonElement;
  private abort = new AbortController();
  private coarse = window.matchMedia('(any-pointer: coarse)');
  private forced = new URLSearchParams(location.search).get('controls') === '1';
  private lastLayout = '';
  private observer: ResizeObserver;

  constructor(hud: HTMLElement, private callbacks: TouchCallbacks) {
    this.root.id = 'touch-controls';
    this.root.innerHTML = `<div class="touch-deck">
      <div class="touch-drive"><div class="touch-stick" role="group" aria-label="Drive: up forward, down reverse, left and right steer"><span class="stick-guide">▲<br>◀ &nbsp; ▶<br>▼</span><span class="stick-knob"></span></div><span>DRIVE / STEER</span></div>
      <div class="touch-action"><button type="button" class="touch-blade" aria-label="Hold powered blade">POWER<br>BLADE</button><span>HOLD TO POWER</span></div>
    </div>`;
    hud.append(this.root);
    this.stick = this.root.querySelector('.touch-stick')!;
    this.knob = this.root.querySelector('.stick-knob')!;
    this.blade = this.root.querySelector('.touch-blade')!;
    const signal = this.abort.signal;
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
    this.observer = new ResizeObserver(() => callbacks.resize());
    this.observer.observe(document.querySelector('#game-root')!);
    this.layout();
  }

  private available(): boolean { return this.enabled && !this.blocked; }

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
    if (blocked) this.reset();
    this.root.querySelector<HTMLElement>('.touch-deck')!.inert = blocked;
    this.root.classList.toggle('blocked', blocked);
  }

  private layout(): void {
    const enabled = this.forced || this.coarse.matches;
    const portrait = window.innerHeight > window.innerWidth;
    const layout = `${enabled}:${portrait}`;
    if (layout === this.lastLayout) return;
    this.lastLayout = layout;
    this.reset();
    this.enabled = enabled;
    document.documentElement.classList.toggle('touch-ui', enabled);
    document.documentElement.classList.toggle('touch-portrait', enabled && portrait);
    this.root.hidden = !enabled;
  }

  destroy(): void {
    this.reset();
    this.abort.abort();
    this.observer.disconnect();
    this.root.remove();
    document.documentElement.classList.remove('touch-ui', 'touch-portrait');
  }
}
