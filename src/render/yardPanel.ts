import type { Town } from '../world/town';
import { type YardAsset, type YardBay } from '../world/yardCatalog';
import { planBatch, placementError, spawnBatch, restoreBay, removeBay, clearTestArea, yardRoadVehicle } from '../world/testYard';
import type { ParticlePool } from '../fx/particles';

export interface YardControls {
  town: () => Town; particles: ParticlePool; dozer: () => { x: number; y: number };
  jump: (x: number, y: number) => void; followRoad: () => void; releaseInput: () => void;
  preview: (bays: YardBay[], valid: boolean) => void; changed: () => void; destroy: (bay: YardBay) => void;
}
export class YardPanel {
  readonly root = document.createElement('details');
  private assets: YardAsset[] = [];
  private filtered: YardAsset[] = [];
  private selected?: YardBay;
  private plan: YardBay[] = [];
  private status: HTMLElement;
  private list: HTMLSelectElement;
  private instances: HTMLSelectElement;
  private timer = 0;
  constructor(parent: HTMLElement, private controls: YardControls) {
    this.root.className = 'yard-panel';
    this.root.innerHTML = `<summary>ASSET TEST YARD</summary><div class="yard-body">
      <p data-coverage></p>
      <input data-search aria-label="Search assets" placeholder="Search name or stable ID">
      <div class="yard-filters"><select data-category aria-label="Category"></select><select data-material aria-label="Material"></select><select data-profile aria-label="Destruction profile"></select></div>
      <select data-assets size="5" aria-label="Asset picker"></select>
      <div class="yard-row"><button data-jump>Jump to baseline</button><button data-area>Experiment area</button></div>
      <div class="yard-row"><label>Variant <input data-variant type="number" value="0" min="0"></label><label>Quantity <input data-quantity type="number" min="1" max="100" value="1"></label></div>
      <div class="yard-row"><label>X <input data-x type="number" step="1"></label><label>Y <input data-y type="number" step="1"></label></div>
      <label><input data-expand type="checkbox"> Expand declared variants</label>
      <div class="yard-row"><button data-preview>Preview selected</button><button data-filtered>Preview all filtered</button></div>
      <div class="yard-row"><button data-place disabled>Place preview</button><button data-cancel>Cancel</button></div>
      <select data-instances aria-label="Selected test instance"></select>
      <button data-instance-jump>Jump to selected instance</button><p data-inspect></p>
      <div class="yard-row"><button data-destroy>Destroy example</button><button data-restore>Restore bay</button></div>
      <div class="yard-row"><button data-remove>Remove added instance</button><button data-debris>Clear debris</button></div>
      <button data-baseline>Restore complete baseline</button>
      <details><summary>Context coverage</summary><p>Buildings include walls, roofs, floors and collapse effects. Fixture bays have an open front and contain ground and upper-floor examples; use Debug → roof visibility / floor controls to inspect inside. Ground: gravel test pads and paved vehicle lane.</p><p>Road vehicle uses the separate single-vehicle driving runtime, not prop health or destruction. It supports one active vehicle; batch copies are unsupported.</p><button data-road>Run road vehicle</button></details>
      <p data-status role="status"></p>
    </div>`;
    parent.append(this.root);
    this.status = this.el('[data-status]'); this.list = this.el('[data-assets]'); this.instances = this.el('[data-instances]');
    for (const event of ['pointerdown', 'keydown', 'keyup', 'wheel']) this.root.addEventListener(event, e => { e.stopPropagation(); controls.releaseInput(); });
    this.root.addEventListener('toggle', () => { controls.releaseInput(); if (!this.root.open) { controls.preview([], true); if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur(); } });
    for (const selector of ['[data-search]', '[data-category]', '[data-material]', '[data-profile]']) this.el(selector).addEventListener('input', () => this.filter());
    this.list.addEventListener('change', () => { this.selected = controls.town().yard?.bays.find(b => b.baseline && b.asset.id === this.list.value); this.cancel(); this.refreshInstances(); });
    this.instances.addEventListener('change', () => { this.selected = controls.town().yard?.bays.find(b => b.key === this.instances.value); this.inspect(); });
    this.action('jump', () => { this.selected = controls.town().yard?.bays.find(b => b.baseline && b.asset.id === this.list.value); this.refreshInstances(); this.jump(); });
    this.action('instance-jump', () => this.jump());
    this.action('area', () => { const t = controls.town(); this.setNumber('x', 8); this.setNumber('y', t.yard!.baselineEnd + 6); controls.jump(4, t.yard!.baselineEnd + 3); });
    this.action('preview', () => this.preview(false)); this.action('filtered', () => this.preview(true));
    this.action('cancel', () => this.cancel());
    this.action('place', () => { spawnBatch(controls.town(), this.plan, controls.dozer()); this.selected = this.plan[0]; this.cancel(); this.refreshInstances(); controls.changed(); this.status.textContent = 'Placed. Select an instance below to inspect, jump or remove it.'; });
    this.action('restore', () => { if (this.selected) { restoreBay(controls.town(), this.selected, controls.particles); controls.changed(); this.inspect(); } });
    this.action('destroy', () => { if (this.selected) { controls.destroy(this.selected); this.inspect(); } });
    this.action('remove', () => { if (!this.selected || this.selected.baseline) throw new Error('Select a user-added instance to remove.'); removeBay(controls.town(), this.selected, controls.particles); this.selected = undefined; this.refreshInstances(); controls.changed(); });
    this.action('debris', () => { if (this.selected) { clearTestArea(controls.town(), this.selected, controls.particles); controls.changed(); } });
    this.action('baseline', () => { for (const b of [...controls.town().yard!.bays]) if (b.baseline) restoreBay(controls.town(), b, controls.particles); this.refreshInstances(); controls.changed(); });
    this.action('road', () => { yardRoadVehicle(controls.town()); controls.followRoad(); });
    for (const field of ['x', 'y', 'quantity', 'variant', 'expand']) this.el(`[data-${field}]`).addEventListener('input', () => this.cancel());
  }
  private el<T extends HTMLElement = HTMLElement>(s: string): T { return this.root.querySelector(s)! as T; }
  private action(name: string, run: () => void): void { this.el(`[data-${name}]`).addEventListener('click', () => { try { run(); } catch (e) { this.status.textContent = String(e instanceof Error ? e.message : e); } }); }
  private number(name: string): number { return Number(this.el<HTMLInputElement>(`[data-${name}]`).value); }
  private setNumber(name: string, n: number): void { this.el<HTMLInputElement>(`[data-${name}]`).value = String(Math.round(n)); }
  private options(el: HTMLSelectElement, values: [string, string][]): void { el.replaceChildren(...values.map(([value, label]) => new Option(label, value))); }
  reset(): void {
    const yard = this.controls.town().yard; this.root.hidden = !yard; this.cancel(); if (!yard) return;
    this.assets = yard.assets;
    this.el('[data-coverage]').textContent = `${yard.bays.filter(b => b.prop || b.building).length}/${this.assets.length} baseline contexts · ${this.assets.filter(a => a.prop).length} props · ${this.assets.filter(a => a.archetype).length} buildings · ${this.assets.filter(a => a.fixture).length} fixtures · ${yard.issues.length} invalid`;
    for (const [field, key] of [['category', 'category'], ['material', 'material'], ['profile', 'destruction']] as const) this.options(this.el(`[data-${field}]`), [['', `All ${field}`], ...[...new Set(this.assets.map(a => a[key]))].map(v => [v, v] as [string, string])]);
    this.setNumber('x', 8); this.setNumber('y', yard.baselineEnd + 6); this.filter(); this.status.textContent = yard.issues.join('\n');
  }
  private filter(): void {
    const q = this.el<HTMLInputElement>('[data-search]').value.toLowerCase();
    this.filtered = this.assets.filter(a => `${a.name} ${a.id}`.toLowerCase().includes(q) &&
      (['category', 'material', 'profile'] as const).every(f => { const value = this.el<HTMLSelectElement>(`[data-${f}]`).value; return !value || a[f === 'profile' ? 'destruction' : f] === value; }));
    this.options(this.list, this.filtered.map(a => [a.id, `${a.name} · ${a.id}`]));
    if (this.filtered[0]) this.list.value = this.filtered[0].id;
    this.selected = this.controls.town().yard?.bays.find(b => b.baseline && b.asset.id === this.list.value); this.cancel(); this.refreshInstances();
  }
  private refreshInstances(): void {
    const bays = this.controls.town().yard?.bays.filter(b => b.asset.id === (this.selected?.asset.id ?? this.list.value)) ?? [];
    this.options(this.instances, bays.map(b => [b.key, `${b.baseline ? 'Baseline' : b.key} · variant ${b.variant}`]));
    if (this.selected) this.instances.value = this.selected.key;
    this.inspect();
  }
  tick(dt: number): void { this.timer += dt; if (this.timer > .3 && this.root.open) { this.timer = 0; this.inspect(); } }
  private inspect(): void {
    const b = this.selected;
    const health = b?.prop ? `${b.prop.hp.toFixed(0)}/${b.prop.maxHp}` : b?.building ?
      (b.asset.fixture ? b.building.fixtures.map(f => `floor ${f.floor}: ${f.hp.toFixed(0)}/${f.maxHp}`).join(' · ') :
      `${b.building.cells.reduce((hp, c) => hp + c.hp, 0).toFixed(0)}/${b.building.cells.reduce((hp, c) => hp + c.maxHp, 0)} HP · ${b.building.cells.filter(c => c.state !== 'gone').length}/${b.building.cells.length} cells`) : 'unavailable';
    this.el('[data-inspect]').textContent = b ? `${b.asset.id} · ${b.key} · variant ${b.variant}\n${b.asset.material} · ${b.asset.destruction}${b.asset.fixture ? " / interior support loss" : ""}${b.asset.prop?.explodeRadius ? " / blast radius " + b.asset.prop.explodeRadius : ""}\nHealth: ${health}` : 'Select an asset.';
    this.el<HTMLButtonElement>('[data-remove]').disabled = !b || b.baseline;
  }
  private jump(): void { const b = this.selected; if (b) this.controls.jump(b.x + b.w / 2, b.y + b.d + 2); }
  private preview(all: boolean): void {
    const assets = all ? this.filtered : this.assets.filter(a => a.id === this.list.value);
    this.plan = planBatch(assets, this.number('quantity'), this.el<HTMLInputElement>('[data-expand]').checked, this.number('x'), this.number('y'), this.number('variant'));
    const error = placementError(this.controls.town(), this.plan, this.controls.dozer());
    this.controls.preview(this.plan, !error); this.el<HTMLButtonElement>('[data-place]').disabled = !!error;
    this.status.textContent = error ?? `${this.plan.length} instances ready. Colored bays show reserved demolition clearance. Place preview to confirm.`;
    if (this.plan[0] && !error) this.controls.jump(this.plan[0].x - 2, this.plan[0].y - 2);
  }
  private cancel(): void { this.plan = []; this.controls.preview([], true); this.el<HTMLButtonElement>('[data-place]').disabled = true; }
}
