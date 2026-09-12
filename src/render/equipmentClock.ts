import { clockValue } from './instrumentValues';

const segments = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
const shapes: Record<string, string> = {
  a: '4,1 16,1 18,3 16,5 4,5 2,3', b: '17,5 19,3 19,15 17,17 15,15 15,7',
  c: '17,19 19,21 19,33 17,35 15,31 15,21', d: '4,33 16,33 18,35 16,37 4,37 2,35',
  e: '3,19 5,21 5,31 3,35 1,33 1,21', f: '3,5 5,7 5,15 3,17 1,15 1,3',
  g: '4,17 16,17 18,19 16,21 4,21 2,19',
};

export class EquipmentClock {
  private last = '';
  constructor(private root: HTMLElement) { root.classList.add('equipment-clock'); root.setAttribute('role', 'img'); }

  update(seconds: number, elapsed: boolean): void {
    const value = clockValue(seconds, elapsed);
    if (this.last === value.accessible) return;
    this.last = value.accessible;
    this.root.setAttribute('aria-label', value.accessible);
    this.root.innerHTML = [...value.display].map(char => char === ':'
      ? '<svg class="clock-colon" viewBox="0 0 8 38" aria-hidden="true"><circle cx="4" cy="12" r="2"/><circle cx="4" cy="27" r="2"/></svg>'
      : `<svg class="clock-digit" viewBox="0 0 20 38" aria-hidden="true">${Object.entries(shapes).map(([key, points]) => `<polygon points="${points}" class="${segments[Number(char)]!.includes(key) ? 'lit' : 'unlit'}"/>`).join('')}</svg>`).join('');
  }
}
