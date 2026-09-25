/** Numbered, measured sheets. Controls stay in their original DOM, preserving listeners and state. */
export class BinderSheets {
  private sheet = 0;
  private groups: HTMLElement[][] = [];
  private pending = false;
  private active?: HTMLElement;
  constructor(private panel: HTMLElement) {
    panel.querySelector('#binder-previous')!.addEventListener('click', () => this.turn(-1));
    panel.querySelector('#binder-next')!.addEventListener('click', () => this.turn(1));
    panel.addEventListener('keydown', e => {
      if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable=true]')) return;
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault(); this.turn(e.key === 'PageDown' ? 1 : -1);
      }
    });
    new ResizeObserver(() => this.refresh()).observe(panel);
    new ResizeObserver(() => this.refresh()).observe(panel.querySelector('.debug-pages')!);
    new MutationObserver(records => {
      const changed = records.some(record => {
        if (record.type === 'attributes') return record.oldValue !== (record.target as Element).getAttribute(record.attributeName!);
        if (record.type === 'childList') {
          const added = [...record.addedNodes], removed = [...record.removedNodes];
          if ([...added, ...removed].every(node => node.nodeType === Node.TEXT_NODE)) {
            return added.map(n => n.textContent).join('') !== removed.map(n => n.textContent).join('');
          }
        }
        return true;
      });
      if (changed) this.refresh();
    }).observe(panel.querySelector('.debug-pages')!, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'open'],
    });
    panel.addEventListener('toggle', () => this.refresh(), true);
  }
  reset(): void { this.sheet = 0; this.refresh(); }
  refresh(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.layout(); });
  }
  private layout(): void {
    if (this.panel.hidden || this.panel.classList.contains('binder-collapsed')) return;
    const active = this.panel.querySelector<HTMLElement>('[role=tabpanel]:not([hidden])')!;
    if (active !== this.active) { this.active = active; this.sheet = 0; }
    const atoms: HTMLElement[] = [];
    const walk = (parent: HTMLElement) => {
      for (const el of [...parent.children] as HTMLElement[]) {
        el.classList.remove('binder-off-sheet');
        if (el.hidden) continue;
        if (el.matches('button, label, input, select, p, h3, legend, summary')) {
          if (el.matches('.yard-panel > summary')) continue;
          if (el.tagName === 'P' && !el.textContent?.trim()) continue;
          el.classList.add('binder-atom'); atoms.push(el);
        } else {
          el.classList.add('binder-flow');
          if (el instanceof HTMLDetailsElement && !el.open) {
            const summary = el.querySelector<HTMLElement>(':scope > summary');
            if (summary) { summary.classList.remove('binder-off-sheet'); summary.classList.add('binder-atom'); atoms.push(summary); }
          } else walk(el);
        }
      }
    };
    walk(active);
    const pages = this.panel.querySelector<HTMLElement>('.debug-pages')!;
    const capacity = pages.clientHeight - 8;
    this.groups = [[]];
    let used = 0;
    atoms.forEach((el, i) => {
      const height = el.getBoundingClientRect().height + 6;
      const heading = el.matches('h3, legend, summary');
      const next = heading ? (atoms[i + 1]?.getBoundingClientRect().height ?? 0) + 6 : 0;
      if (used && used + height + next > capacity) { this.groups.push([]); used = 0; }
      this.groups.at(-1)!.push(el); used += height;
    });
    this.sheet = Math.min(this.sheet, this.groups.length - 1);
    this.paint();
  }
  private turn(direction: number): void {
    this.sheet = Math.max(0, Math.min(this.groups.length - 1, this.sheet + direction));
    this.paint();
  }
  private paint(): void {
    this.groups.forEach((group, i) => group.forEach(el => el.classList.toggle('binder-off-sheet', i !== this.sheet)));
    const label = this.panel.querySelector<HTMLElement>('#binder-sheet-number')!;
    const section = this.active?.getAttribute('aria-labelledby');
    const name = section ? document.getElementById(section)?.textContent : '';
    const first = this.groups[this.sheet]?.[0];
    const flat = this.groups.flat();
    const heading = flat.slice(0, flat.indexOf(first!) + 1).reverse().find(el => el.matches('h3, legend, summary'));
    this.panel.querySelector('#binder-subsection')!.textContent = heading?.textContent ?? (name === 'Assets' ? 'Asset catalog' : name === 'Inspector' ? 'Visibility and diagnostics' : 'Operating session');
    label.textContent = `${name} · Sheet ${this.sheet + 1} / ${this.groups.length}`;
    this.panel.querySelector<HTMLButtonElement>('#binder-previous')!.disabled = this.sheet === 0;
    this.panel.querySelector<HTMLButtonElement>('#binder-next')!.disabled = this.sheet === this.groups.length - 1;
    this.panel.dataset.sheet = String(this.sheet + 1);
    this.panel.dataset.sheets = String(this.groups.length);
  }
}
