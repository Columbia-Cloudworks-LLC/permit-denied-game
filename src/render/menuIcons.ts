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
} as const;

export function labeledMenuButton(iconHtml: string, label: string): string {
  return `<span class="menu-btn-icon">${iconHtml}</span><span>${label}</span>`;
}

export function soundButtonContent(muted: boolean): string {
  return `<span>Sound:</span><span class="menu-btn-icon">${muted ? MENU_ICONS.speakerMuted : MENU_ICONS.speaker}</span>`;
}
