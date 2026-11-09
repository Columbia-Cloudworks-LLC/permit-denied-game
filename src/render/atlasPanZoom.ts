/**
 * Pan and zoom for one atlas SVG by rewriting its viewBox: wheel zooms toward the cursor, drag
 * pans, two fingers pinch, and the corner buttons step or reset. A press that moves less than
 * DRAG_PX is a click; anything farther is a pan and its click is swallowed, so dragging the map
 * never changes the selection.
 */

export interface View { x: number; y: number; w: number; h: number }

export const DRAG_PX = 5;
const STEP = 1.6;

export class PanZoom {
  view: View;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private start?: { x: number; y: number };
  private panning = false;
  private swallowClick = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly viewport: HTMLElement,
    private readonly svg: SVGSVGElement,
    private readonly base: View,
    initial?: View,
    private readonly maxZoom = 24,
  ) {
    this.view = initial ? { ...initial } : { ...base };
    this.clamp();
    this.apply();
    const opts = { signal: this.abort.signal };
    viewport.addEventListener('pointerdown', e => this.down(e), opts);
    viewport.addEventListener('pointermove', e => this.move(e), opts);
    for (const type of ['pointerup', 'pointercancel'] as const) viewport.addEventListener(type, e => this.up(e), opts);
    // Only the viewport's own capture loss ends a drag. On touch the browser implicitly captures
    // the pointer to the path under the finger; moving that capture to the viewport fires a
    // bubbling lostpointercapture from the path while the finger is still down.
    viewport.addEventListener('lostpointercapture', e => { if (e.target === viewport) this.up(e); }, opts);
    viewport.addEventListener('wheel', e => this.wheel(e), { ...opts, passive: false });
    viewport.addEventListener('click', e => {
      if (!this.swallowClick) return;
      this.swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    }, { ...opts, capture: true });
    viewport.querySelector('.atlas-zoom')?.addEventListener('click', e => {
      const zoom = (e.target as Element).closest<HTMLElement>('[data-zoom]')?.dataset.zoom;
      if (zoom === 'in') this.zoomBy(STEP);
      else if (zoom === 'out') this.zoomBy(1 / STEP);
      else if (zoom === 'reset') this.reset();
    }, opts);
  }

  destroy(): void {
    this.abort.abort();
  }

  get zoom(): number {
    return this.base.w / this.view.w;
  }

  reset(): void {
    this.view = { ...this.base };
    this.apply();
  }

  /** Zoom by `factor` (> 1 zooms in) keeping the SVG point (cx, cy) fixed on screen. */
  zoomBy(factor: number, cx = this.view.x + this.view.w / 2, cy = this.view.y + this.view.h / 2): void {
    const minW = this.base.w / this.maxZoom;
    const w = Math.min(this.base.w, Math.max(minW, this.view.w / factor));
    const scale = w / this.view.w;
    this.view = { x: cx - (cx - this.view.x) * scale, y: cy - (cy - this.view.y) * scale, w, h: this.view.h * scale };
    this.clamp();
    this.apply();
  }

  /** Pan by a screen-pixel delta. */
  panBy(dx: number, dy: number): void {
    const s = this.pixelScale();
    this.view.x -= dx / s;
    this.view.y -= dy / s;
    this.clamp();
    this.apply();
  }

  /** SVG units per screen pixel inverted: screen px per unit under `xMidYMid meet`. */
  private pixelScale(): number {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return 1;
    return Math.min(rect.width / this.view.w, rect.height / this.view.h);
  }

  private toSvg(clientX: number, clientY: number): [number, number] {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return [this.view.x + this.view.w / 2, this.view.y + this.view.h / 2];
    const s = Math.min(rect.width / this.view.w, rect.height / this.view.h);
    const ox = (rect.width - this.view.w * s) / 2, oy = (rect.height - this.view.h * s) / 2;
    return [this.view.x + (clientX - rect.left - ox) / s, this.view.y + (clientY - rect.top - oy) / s];
  }

  /** Keep the view inside the map, so it can never be lost off screen; zoom 1 shows it all. */
  private clamp(): void {
    const { base, view } = this;
    view.x = Math.min(base.x + base.w - view.w, Math.max(base.x, view.x));
    view.y = Math.min(base.y + base.h - view.h, Math.max(base.y, view.y));
  }

  private apply(): void {
    const { x, y, w, h } = this.view;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    this.svg.setAttribute('viewBox', `${r(x)} ${r(y)} ${r(w)} ${r(h)}`);
    this.viewport.dataset.zoomed = String(this.zoom > 1.001);
    // Labels and pins shrink in map units as the map zooms, so on screen they grow only gently.
    this.svg.style.setProperty('--label-scale', String(Math.round(this.zoom ** -0.6 * 1000) / 1000));
  }

  private down(e: PointerEvent): void {
    if ((e.target as Element).closest('.atlas-zoom') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.start = { x: e.clientX, y: e.clientY };
      this.panning = false;
      this.swallowClick = false;
    }
  }

  private move(e: PointerEvent): void {
    const last = this.pointers.get(e.pointerId);
    if (!last) return;
    const next = { x: e.clientX, y: e.clientY };
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.entries()];
      const other = a![0] === e.pointerId ? b![1] : a![1];
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      const mid = this.toSvg((next.x + other.x) / 2, (next.y + other.y) / 2);
      if (before > 0 && after > 0) this.zoomBy(after / before, mid[0], mid[1]);
      this.panBy((next.x - last.x) / 2, (next.y - last.y) / 2);
      this.panning = true;
    } else if (this.start) {
      if (!this.panning && Math.hypot(next.x - this.start.x, next.y - this.start.y) >= DRAG_PX) {
        this.panning = true;
        try { this.viewport.setPointerCapture(e.pointerId); } catch { /* capture is best effort */ }
      }
      if (this.panning) this.panBy(next.x - last.x, next.y - last.y);
    }
    this.pointers.set(e.pointerId, next);
    if (this.panning) this.viewport.classList.add('panning');
  }

  private up(e: PointerEvent): void {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size === 0) {
      if (this.panning) this.swallowClick = true;
      this.panning = false;
      this.start = undefined;
      this.viewport.classList.remove('panning');
      // A pan that ends off the map leaves no click behind to swallow.
      if (this.swallowClick) setTimeout(() => { this.swallowClick = false; }, 400);
    }
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const [cx, cy] = this.toSvg(e.clientX, e.clientY);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomBy(Math.exp(-delta * 0.0015), cx, cy);
  }
}
