import { CASH_TARGET, MATCH_SECONDS } from './constants';
import { DISTRICT_COUNTS, type DistrictId, type SessionKind } from './session';

export const MODE_LABELS: Record<SessionKind, string> = { challenge: 'Timed Challenge', sandbox: 'Sandbox' };
export const MODE_DESCRIPTIONS: Record<SessionKind, string> = {
  challenge: `Earn $${CASH_TARGET.toLocaleString('en-US')} in ${MATCH_SECONDS / 60} minutes. Overheating or excessive track stress ends the game.`,
  sandbox: 'Demolish freely with no time limit or breakdowns.',
};
export const SITE_LABELS = Object.fromEntries(Object.entries(DISTRICT_COUNTS).map(([id, count]) => [id, `${count} buildings`])) as Record<DistrictId, string>;
export const MENU_LABELS = {
  play: 'Play', pause: 'Pause', resume: 'Resume', restart: 'Restart Site', newLayout: 'New Layout',
  newGame: 'New Game', start: 'Start Game', mainMenu: 'Main Menu', controls: 'Controls', about: 'About',
  debug: 'Debug', soundOn: 'Sound On', soundOff: 'Sound Off',
  brick: 'Brick Building Demolition', brickPreview: 'Brick Building Preview', yard: 'Open Test Yard',
  blade: 'Blade', engine: 'Engine', push: 'Push',
};
export const BRICK_DESCRIPTION = 'Demolish 90% of the brick building and let it settle. Earn $1,200 and an upgrade. No time limit or breakdowns.';
