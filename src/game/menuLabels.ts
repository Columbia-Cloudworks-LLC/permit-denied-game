import { DISTRICT_COUNTS, type DistrictId, type SessionKind } from './session';

export const MODE_LABELS: Record<SessionKind, string> = { sandbox: 'Sandbox', challenge: 'Time Challenge' };
export const MODE_DESCRIPTIONS: Record<SessionKind, string> = {
  challenge: 'Seven-level campaign. Destroy the landmark and earn the level dollar target before the county clock expires. Overheating or excessive track stress ends the level.',
  sandbox: 'Demolish freely with no time limit or breakdowns.',
};
export const SITE_LABELS = Object.fromEntries(Object.entries(DISTRICT_COUNTS).filter(([id]) => id !== 'classic').map(([id, count]) => [id, `${count} buildings`])) as Record<Exclude<DistrictId, "classic">, string>;
export const MENU_LABELS = {
  play: 'Play', pause: 'Pause', resume: 'Resume', restart: 'Restart Site', newLayout: 'New Layout',
  newGame: 'New Game', start: 'Start Game', mainMenu: 'Main Menu', nextLevel: 'Next Level', retryLevel: 'Retry Level',
  beginLevel: 'Begin Level', newCampaign: 'New Campaign', controls: 'Controls', about: 'About',
  reloadBuild: 'Reload Latest Build',
  reloadBuildHelp: 'A newer county build is ready. Reload to apply it. The current run stays on this version until then.',
  debug: 'Debug', soundOn: 'Sound On', soundOff: 'Sound Off',
  brick: 'Brick Building Demolition', brickPreview: 'Brick Building Preview', yard: 'Open Test Yard',
  blade: 'Blade', engine: 'Engine', push: 'Push',
};
export const BRICK_DESCRIPTION = 'Demolish 90% of the brick building and let it settle. Earn $1,200 and an upgrade. No time limit or breakdowns.';
