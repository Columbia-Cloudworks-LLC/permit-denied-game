import { describe, expect, it } from 'vitest';
import { labeledMenuButton, MENU_ICONS, soundButtonContent } from './menuIcons';

describe('menu icons', () => {
  it('uses inline SVG glyphs instead of symbol-font characters', () => {
    expect(MENU_ICONS.power).toContain('data-menu-icon="power"');
    expect(MENU_ICONS.gamepad).toContain('data-menu-icon="gamepad"');
    expect(MENU_ICONS.speaker).toContain('data-menu-icon="speaker"');
    expect(MENU_ICONS.speakerMuted).toContain('data-menu-icon="speaker-muted"');
    expect(MENU_ICONS.about).toContain('data-menu-icon="about"');
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

  it('renders Sound: with a speaker that mutes through a circled slash', () => {
    const on = soundButtonContent(false);
    const off = soundButtonContent(true);
    expect(on.indexOf('Sound:')).toBeLessThan(on.indexOf('<svg'));
    expect(off.indexOf('Sound:')).toBeLessThan(off.indexOf('<svg'));
    expect(on).toContain('data-menu-icon="speaker"');
    expect(off).toContain('data-menu-icon="speaker-muted"');
    expect(off).toContain('<circle');
    expect(off).toContain('M14.4 15.3');
    expect(on).not.toBe(off);
  });
});
