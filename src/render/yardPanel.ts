import { yardVehicleRoute, runYardFleet, testVehicleImpact, planBatch, placementError, spawnBatch, restoreBay, removeBay, clearBayDebris } from '../world/testYard';
import { parkVehicle } from '../vehicle/runtime';
import type { Town } from '../world/town';
import { discoverYardAssets, type YardAsset, type YardBay } from '../world/yardCatalog';
import type { ParticlePool } from '../fx/particles';
import type { DebugBinderState } from '../debug/binderState';

export interface YardControls {
  town: () => Town; particles: ParticlePool; dozer: () => { x: number; y: number };
  jump: (x: number, y: number) => void; releaseInput: () => void;
  preview: (bays: YardBay[], valid: boolean) => void; changed: () => void; destroy: (bay: YardBay) => void;
  frame: (bay: YardBay) => void; followVehicle: (bay: YardBay) => void;
  testAsset: (assetId: string, variant: number) => void;
}

/** The catalog survives Town replacement; placed instances are resolved by stable key. */
export class YardPanel {
  readonly root = document.createElement('details');
  private assets = discoverYardAssets();
  private filtered: YardAsset[] = [];
  private plan: YardBay[] = [];
  private timer = 0;
  private get selected(): YardBay | undefined {
    const yard = this.controls.town().yard;
    if (yard?.request.kind === 'asset') return yard.bays[0];
    return yard?.bays.find(b => b.key === this.state.instanceKey && b.asset.id === this.state.assetId)
      ?? yard?.bays.find(b => b.baseline && b.asset.id === this.state.assetId);
  }
  constructor(parent: HTMLElement, private controls: YardControls, private state: DebugBinderState) {
    this.root.className = 'yard-panel'; this.root.open = true;
    this.root.innerHTML = `<summary>Asset catalog</summary><div class="yard-body">
      <p data-coverage></p>
      <input data-search aria-label="Search assets" placeholder="Search name or stable ID">
      <div class="yard-filters"><select data-category aria-label="Category"></select><select data-material aria-label="Material"></select><select data-profile aria-label="Destruction profile"></select></div>
      <select data-assets size="5" aria-label="Asset picker"></select>
      <div class="yard-row"><label>Variant <input data-variant type="number" value="0" min="0" aria-label="Variant"></label><button class="binder-primary" data-test>Test This Asset</button></div>
      <p data-status role="status"></p>
      <section data-loaded><h3>Loaded example</h3>
        <select data-instances aria-label="Selected test instance"></select>
        <p data-inspect></p>
        <div class="yard-row"><button data-instance-jump>Move dozer here</button><button data-frame>View whole example</button></div>
        <div class="yard-row"><button data-destroy>Destroy example</button><button data-restore>Restore Selected Asset</button></div>
        <details data-section="vehicle" open><summary>Vehicle controls</summary>
          <div class="yard-row"><button data-run>Run route</button><button data-stop>Park / stop</button><button data-follow>Follow vehicle</button></div>
          <div class="yard-row"><button data-fleet data-yard-only>Run all 12</button><button data-regions>Damage / attachments</button></div>
          <div class="yard-row"><button data-front>Front impact</button><button data-side>Side impact</button><button data-rear>Rear impact</button><button data-overhead>Overhead load</button></div>
        </details>
      </section>
      <details data-section="batch" data-yard-only><summary>Batch placement & experiments</summary>
        <button data-area>Go to experiment area</button>
        <div class="yard-row"><label>Quantity <input data-quantity type="number" min="1" max="100" value="1"></label><label>X <input data-x type="number" step="1"></label><label>Y <input data-y type="number" step="1"></label></div>
        <label><input data-expand type="checkbox"> Expand declared variants</label>
        <div class="yard-row"><button data-preview>Preview selected</button><button data-filtered>Preview all filtered</button></div>
        <div class="yard-row"><button data-place disabled>Place preview</button><button data-cancel>Cancel</button></div>
        <div class="yard-row"><button data-remove>Remove added instance</button><button data-debris>Clear owned debris</button></div>
        <button data-baseline>Restore complete baseline</button>
      </details>
      <details data-section="context"><summary>About these tests</summary><p>Buildings keep their contents. Sites include their authored buildings and equipment. Interior fixtures use an open-front support structure. Use Inspector to look through roofs and floors.</p><p>Reset Test restores the asset and dozer while keeping your upgrades and debug settings. Restore Selected Asset leaves your dozer in place.</p></details>
    </div>`;
    parent.append(this.root);
    for (const event of ['pointerdown', 'keydown', 'keyup', 'wheel']) this.root.addEventListener(event, e => { e.stopPropagation(); controls.releaseInput(); });
    this.root.querySelectorAll<HTMLDetailsElement>('[data-section]').forEach(details => {
      details.open = state.expanded[details.dataset.section!] ?? details.open;
      details.addEventListener('toggle', () => { state.expanded[details.dataset.section!] = details.open; });
    });
    for (const field of ['search', 'category', 'material', 'profile'] as const) this.el<HTMLInputElement>(`[data-${field}]`).addEventListener('input', e => {
      state[field] = (e.target as HTMLInputElement).value; this.filter(true);
    });
    this.el('[data-assets]').addEventListener('change', () => {
      state.assetId = this.el<HTMLSelectElement>('[data-assets]').value; state.variant = 0; state.instanceKey = undefined;
      this.syncVariant(); this.cancel(); this.refreshInstances();
    });
    this.el('[data-variant]').addEventListener('input', () => { state.variant = this.number('variant'); this.cancel(); });
    this.el('[data-instances]').addEventListener('change', () => { state.instanceKey = this.el<HTMLSelectElement>('[data-instances]').value; this.inspect(); });
    this.action('test', () => {
      const asset = this.assets.find(a => a.id === state.assetId);
      if (!asset || !Number.isInteger(state.variant) || state.variant < 0 || state.variant >= asset.variants) throw new Error(`Choose an asset and a variant from 0 to ${asset ? asset.variants - 1 : 0}.`);
      controls.testAsset(asset.id, state.variant);
    });
    this.action('instance-jump', () => this.jump());
    this.action('frame', () => { if (this.selected) controls.frame(this.selected); });
    this.action('area', () => { const y = controls.town().yard!.baselineEnd; this.setNumber('x', 8); this.setNumber('y', y + 6); controls.jump(4, y + 3); });
    this.action('preview', () => this.preview(false)); this.action('filtered', () => this.preview(true));
    this.action('cancel', () => this.cancel());
    this.action('place', () => {
      spawnBatch(controls.town(), this.plan, controls.dozer()); state.instanceKey = this.plan[0]?.key; state.assetId = this.plan[0]?.asset.id ?? state.assetId;
      this.cancel(); this.filter(); controls.changed(); this.status('Placed. Select an instance to inspect or remove it.');
    });
    this.action('restore', () => { if (this.selected) { restoreBay(controls.town(), this.selected, controls.particles); controls.changed(); this.inspect(); } });
    this.action('destroy', () => { if (this.selected) { controls.destroy(this.selected); this.inspect(); } });
    this.action('remove', () => {
      if (!this.selected || this.selected.baseline) throw new Error('Select a user-added instance to remove.');
      removeBay(controls.town(), this.selected, controls.particles); state.instanceKey = undefined; this.refreshInstances(); controls.changed();
    });
    this.action('debris', () => { if (this.selected) { clearBayDebris(controls.town(), this.selected, controls.particles); controls.changed(); } });
    this.action('baseline', () => { for (const b of [...controls.town().yard!.bays]) if (b.baseline) restoreBay(controls.town(), b, controls.particles); this.refreshInstances(); controls.changed(); });
    this.action('run', () => { if (this.selected?.vehicle) yardVehicleRoute(this.selected.vehicle, 0, this.selected); });
    this.action('stop', () => { if (this.selected?.vehicle) parkVehicle(this.selected.vehicle); });
    this.action('follow', () => { if (this.selected?.vehicle) controls.followVehicle(this.selected); });
    this.action('fleet', () => runYardFleet(controls.town()));
    this.action('regions', () => { if (this.selected?.vehicle) this.selected.vehicle.debugParts = !this.selected.vehicle.debugParts; });
    for (const kind of ['front', 'side', 'rear', 'overhead'] as const) this.action(kind, () => {
      const vehicle = this.selected?.vehicle;
      if (!vehicle) return;
      if (kind === 'overhead') {
        const yard = controls.town().yard!; yard.loads ??= [];
        if (!yard.loads.some(l => l.vehicle === vehicle)) yard.loads.push({ vehicle, z: 4, vz: 0 });
      } else testVehicleImpact(vehicle, kind);
    });
    for (const field of ['x', 'y', 'quantity', 'expand']) this.el(`[data-${field}]`).addEventListener('input', () => this.cancel());
  }
  private el<T extends HTMLElement = HTMLElement>(s: string): T { return this.root.querySelector(s)! as T; }
  private status(message: string): void { this.el('[data-status]').textContent = message; }
  private action(name: string, run: () => void): void { this.el(`[data-${name}]`).addEventListener('click', () => { try { run(); } catch (e) { this.status(e instanceof Error ? e.message : String(e)); } }); }
  private number(name: string): number { return Number(this.el<HTMLInputElement>(`[data-${name}]`).value); }
  private setNumber(name: string, n: number): void { this.el<HTMLInputElement>(`[data-${name}]`).value = String(Math.round(n)); }
  private options(el: HTMLSelectElement, values: [string, string][]): void { el.replaceChildren(...values.map(([value, label]) => new Option(label, value))); }

  reset(): void {
    const yard = this.controls.town().yard; this.cancel();
    this.assets = yard?.assets ?? discoverYardAssets();
    if (!this.state.assetId) {
      const request = yard?.request;
      this.state.assetId = request?.kind === 'asset' ? request.assetId : this.assets[0]?.id ?? '';
      this.state.variant = request?.kind === 'asset' ? request.variant : 0;
    }
    this.el<HTMLInputElement>('[data-search]').value = this.state.search;
    for (const [field, key] of [['category', 'category'], ['material', 'material'], ['profile', 'destruction']] as const) {
      const select = this.el<HTMLSelectElement>(`[data-${field}]`);
      this.options(select, [['', field[0].toUpperCase() + field.slice(1)], ...[...new Set(this.assets.map(a => a[key]))].map(v => [v, v] as [string, string])]);
      select.value = this.state[field];
    }
    this.root.querySelectorAll<HTMLElement>('[data-yard-only]').forEach(el => { el.hidden = yard?.request.kind !== 'yard'; });
    if (!this.el<HTMLInputElement>('[data-x]').value) this.setNumber('x', 8);
    if (!this.el<HTMLInputElement>('[data-y]').value || this.number('y') > this.controls.town().maxY) this.setNumber('y', (yard?.baselineEnd ?? 0) + 6);
    this.filter(); this.status(yard?.issues.join('\n') ?? 'Choose an asset to open a focused test map.');
  }
  private filter(fromInput = false): void {
    const q = this.state.search.toLowerCase();
    this.filtered = this.assets.filter(a => `${a.name} ${a.id} ${Object.values(a.archetype?.traits ?? {}).flat().join(' ')}`.toLowerCase().includes(q) &&
      (['category', 'material', 'profile'] as const).every(f => !this.state[f] || a[f === 'profile' ? 'destruction' : f] === this.state[f]));
    if (fromInput && !this.filtered.some(a => a.id === this.state.assetId)) {
      this.state.assetId = this.filtered[0]?.id ?? ''; this.state.variant = 0; this.state.instanceKey = undefined;
    }
    const list = this.el<HTMLSelectElement>('[data-assets]');
    this.options(list, this.filtered.map(a => [a.id, `${a.name} · ${a.id}`])); list.value = this.state.assetId;
    list.size = Math.max(2, Math.min(5, this.filtered.length));
    this.el('[data-coverage]').textContent = `${this.filtered.length} of ${this.assets.length} assets · buildings, vehicles, props, sites & fixtures`;
    this.el<HTMLButtonElement>('[data-test]').disabled = !this.assets.some(a => a.id === this.state.assetId);
    this.syncVariant(); this.cancel(); this.refreshInstances();
  }
  private syncVariant(): void {
    const input = this.el<HTMLInputElement>('[data-variant]'); input.value = String(this.state.variant);
    input.max = String((this.assets.find(a => a.id === this.state.assetId)?.variants ?? 1) - 1);
  }
  private refreshInstances(): void {
    const yard = this.controls.town().yard;
    const bays = yard?.request.kind === 'asset' ? yard.bays : yard?.bays.filter(b => b.asset.id === this.state.assetId) ?? [];
    const instances = this.el<HTMLSelectElement>('[data-instances]');
    this.options(instances, bays.map(b => [b.key, `${b.baseline ? b.asset.name : b.key} · variant ${b.variant}`]));
    const b = this.selected; if (b) instances.value = b.key;
    instances.hidden = bays.length < 2;
    this.inspect();
  }
  tick(dt: number): void { this.timer += dt; if (this.timer > .3 && this.root.open) { this.timer = 0; this.inspect(); } }
  private inspect(): void {
    const b = this.selected;
    this.el('[data-loaded]').hidden = !b;
    this.el('[data-section="vehicle"]').hidden = !b?.vehicle;
    const health = b?.vehicle ? `${b.vehicle.status} · ${b.vehicle.routeStatus} · ${b.vehicle.parts.filter(p => p.detached).length} detached assemblies`
      : b?.site ? b.site.buildings.map(member => `${member.name.split(' / ').at(-1)}: ${member.cells.filter(c => c.hp > 0).length}/${member.cells.length} cells`).join(' · ')
      : b?.prop ? `${b.prop.hp.toFixed(0)}/${b.prop.maxHp} HP`
      : b?.building ? (b.asset.fixture ? b.building.fixtures.map(f => `${f.hp.toFixed(0)}/${f.maxHp} HP`).join(' · ')
        : `${b.building.cells.filter(c => c.state !== 'gone').length}/${b.building.cells.length} cells`) : '';
    const text = b ? `${b.asset.name} · variant ${b.variant}\n${b.asset.material} · ${b.asset.destruction}\n${health}` : '';
    if (this.el('[data-inspect]').textContent !== text) this.el('[data-inspect]').textContent = text;
    this.el<HTMLButtonElement>('[data-remove]').disabled = !b || b.baseline;
  }
  private jump(): void { const b = this.selected; if (b) this.controls.jump(b.x + b.w / 2, b.y + b.asset.clearance + b.asset.d + 5); }
  private preview(all: boolean): void {
    const assets = all ? this.filtered : this.assets.filter(a => a.id === this.state.assetId);
    this.plan = planBatch(assets, this.number('quantity'), this.el<HTMLInputElement>('[data-expand]').checked, this.number('x'), this.number('y'), this.state.variant);
    const error = placementError(this.controls.town(), this.plan, this.controls.dozer());
    this.controls.preview(this.plan, !error); this.el<HTMLButtonElement>('[data-place]').disabled = !!error;
    this.status(error ?? `${this.plan.length} instances ready. Place preview to confirm.`);
    if (this.plan[0] && !error) this.controls.jump(this.plan[0].x - 2, this.plan[0].y - 2);
  }
  private cancel(): void { this.plan = []; this.controls.preview([], true); this.el<HTMLButtonElement>('[data-place]').disabled = true; }
}
