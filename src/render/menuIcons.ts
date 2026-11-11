/** Inline SVG menu glyphs. Vector paths — no emoji or symbol fonts. */

const SPEAKER = '<path d="M3.6 9.4h3.1L11.2 5.2v13.6l-4.5-4.2H3.6z"/><path d="M15.1 9.1a3.6 3.6 0 0 1 0 5.8"/><path d="M17.5 6.7a7 7 0 0 1 0 10.6"/>';
const BAN_RED = '#a12827';
const BAN = `<g class="menu-icon-ban" data-menu-icon-ban="true" stroke="${BAN_RED}" fill="none"><circle cx="12" cy="12" r="10"/><path d="M5.6 18.4 18.4 5.6"/></g>`;

function icon(name: string, markup: string): string {
  return `<svg class="menu-icon" data-menu-icon="${name}" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
}

export const MENU_ICONS = {
  power: icon('power', '<path d="M12 3.5v8"/><path d="M7.6 6.7a6.4 6.4 0 1 0 8.8 0"/>'),
  gamepad: icon(
    'gamepad',
    '<path d="M8.2 6.2v2M15.8 6.2v2"/><rect x="2.4" y="8.1" width="19.2" height="10.6" rx="2.4"/><path d="M8.1 10.8v5M5.6 13.3h5"/><circle cx="15.3" cy="12" r="1.05" fill="currentColor" stroke="none"/><circle cx="17.8" cy="14.8" r="1.05" fill="currentColor" stroke="none"/>',
  ),
  speaker: icon('speaker', SPEAKER),
  speakerMuted: icon('speaker-muted', SPEAKER + BAN),
  about: icon(
    'about',
    '<circle cx="12" cy="12" r="9"/><path d="M9.7 9.5a2.4 2.4 0 1 1 3.5 2.1c-.8.5-1.3 1.1-1.3 2.1"/><circle cx="12" cy="17.1" r=".85" fill="currentColor" stroke="none"/>',
  ),
  play: icon('play', '<path d="M8 5.5v13l10-6.5z"/>'),
  pause: icon('pause', '<path d="M8.5 5.5v13M15.5 5.5v13"/>'),
  back: icon('back', '<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  /** A folded road map. */
  map: icon('map', '<path d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5L3.5 20z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  globe: icon('globe', '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-5 5-5 12 0 17M12 3.5c5 5 5 12 0 17"/>'),
  restart: icon('restart', '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4.2h4.2"/>'),
  yard: icon('yard', '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>'),
  exit: icon('exit', '<path d="M10 4.5H5.5v15H10"/><path d="M10 12h10M16 8l4 4-4 4"/>'),
  wrench: icon('wrench', '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17v3h3l5.2-5.2a4 4 0 0 0 5.3-5.3L15 12l-3-3z"/>'),
  clipboard: icon('clipboard', '<rect x="5.5" y="5" width="13" height="15.5" rx="1.5"/><path d="M9 5V3.5h6V5M9 10.5h6M9 14.5h4"/>'),
  caution: icon('caution', '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17v.2"/>'),
  fold: icon('fold', '<path d="M6 14.5l6-6 6 6"/>'),
  close: icon('close', '<path d="M6 6l12 12M18 6L6 18"/>'),
  cube: icon('cube', '<path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z"/><path d="M4.5 7.7 12 12l7.5-4.3M12 12v8.5"/>'),
  eye: icon('eye', '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
} as const;

export function labeledMenuButton(iconHtml: string, label: string): string {
  return `<span class="menu-btn-icon">${iconHtml}</span><span class="menu-btn-label">${label}</span>`;
}

export function soundButtonContent(muted: boolean): string {
  return labeledMenuButton(muted ? MENU_ICONS.speakerMuted : MENU_ICONS.speaker, 'Sound');
}
