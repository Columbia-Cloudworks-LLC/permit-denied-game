import { describe, expect, it } from 'vitest';
import { labeledMenuButton, MENU_ICONS, soundButtonContent } from './menuIcons';

describe('menu icons', () => {
  it('uses inline SVG glyphs instead of symbol-font characters', () => {
    expect(MENU_ICONS.power).toContain('data-menu-icon="power"');
    expect(MENU_ICONS.gamepad).toContain('data-menu-icon="gamepad"');
    expect(MENU_ICONS.speaker).toContain('data-menu-icon="speaker"');
    expect(MENU_ICONS.speakerMuted).toContain('data-menu-icon="speaker-muted"');
    expect(MENU_ICONS.about).toContain('data-menu-icon="about"');
    expect(MENU_ICONS.blade).toContain('data-menu-icon="blade"');
    expect(MENU_ICONS.engine).toContain('data-menu-icon="engine"');
    expect(MENU_ICONS.push).toContain('data-menu-icon="push"');
    for (const [name, markup] of Object.entries(MENU_ICONS)) {
      expect(markup, name).toContain('<svg');
      expect(markup, name).not.toMatch(/⏻|🎮|🔊|🔇|❓|❔/);
    }
  });

  it('labels Controls and About next to their icons', () => {
    expect(labeledMenuButton(MENU_ICONS.gamepad, 'Controls')).toContain('data-menu-icon="gamepad"');
    expect(labeledMenuButton(MENU_ICONS.gamepad, 'Controls')).toContain('Controls');
    expect(labeledMenuButton(MENU_ICONS.about, 'About')).toContain('data-menu-icon="about"');
    expect(labeledMenuButton(MENU_ICONS.about, 'About')).toContain('About');
    expect(MENU_ICONS.about).toContain('<circle');
    expect(MENU_ICONS.about).toMatch(/M9\.7 9\.5/);
  });

  it('renders Sound with a speaker icon before the label, muted through a circled slash', () => {
    const on = soundButtonContent(false);
    const off = soundButtonContent(true);
    expect(on).toBe(labeledMenuButton(MENU_ICONS.speaker, 'Sound'));
    expect(off).toBe(labeledMenuButton(MENU_ICONS.speakerMuted, 'Sound'));
    expect(on.indexOf('<svg')).toBeLessThan(on.indexOf('Sound'));
    expect(off.indexOf('<svg')).toBeLessThan(off.indexOf('Sound'));
    expect(on).toContain('data-menu-icon="speaker"');
    expect(off).toContain('data-menu-icon="speaker-muted"');
    expect(off).toContain('data-menu-icon-ban="true"');
    expect(off).toContain('#a12827');
    expect(off.indexOf('M3.6 9.4')).toBeLessThan(off.indexOf('data-menu-icon-ban'));
    expect(off).toContain('cx="12"');
    expect(off).not.toContain('cx="17.5"');
    expect(on).not.toBe(off);
    expect(on).not.toContain('data-menu-icon-ban');
    expect(on.replace(MENU_ICONS.speaker, '')).toBe(off.replace(MENU_ICONS.speakerMuted, ''));
  });
});
