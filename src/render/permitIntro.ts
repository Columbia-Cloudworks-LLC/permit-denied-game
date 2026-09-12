import { TAGLINE, TITLE } from '../game/constants';

export type PermitSound = 'stamp' | 'key';

export function permitDocument(interactive = true): string {
  return `<div class="permit-slot"><div class="permit-paper" ${interactive ? 'role="button" tabindex="0" aria-label="Replay permit stamp animation" data-replay-permit' : ''}>
    <div class="permit-form" aria-hidden="true">
      <div class="permit-office">COUNTY BUILDING DEPARTMENT</div>
      <div class="permit-form-title">APPLICATION FOR DEMOLITION</div>
      <div class="permit-fields"><span>PROPERTY <i></i></span><span>DATE <i></i></span></div>
      <div class="permit-fields"><span>APPLICANT <i></i></span></div>
      <div class="permit-request">☒ STRUCTURE REMOVAL <span>☐ OTHER</span></div>
      <div class="permit-signature">AUTHORIZATION <i></i></div>
    </div>
    <div class="permit-stamp" aria-hidden="true">${TITLE.replace(' ', '<br>')}</div>
    <p class="permit-verdict" aria-label="${TAGLINE}"><span aria-hidden="true" data-typed-verdict></span><span class="typewriter-caret" aria-hidden="true"></span></p>
  </div></div>`;
}

/** Owns the short intro so navigating away cannot leave typing or sounds running. */
export class PermitIntro {
  private timers: number[] = [];
  private paper?: HTMLElement;

  stop(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.paper?.classList.remove('permit-enter', 'permit-hit', 'permit-typing');
    this.paper = undefined;
  }

  play(paper: HTMLElement, sound: (kind: PermitSound, index: number) => void, reducedMotion: boolean): void {
    this.stop();
    this.paper = paper;
    const text = paper.querySelector<HTMLElement>('[data-typed-verdict]')!;
    paper.classList.remove('permit-ready');
    text.textContent = reducedMotion ? TAGLINE : '';
    if (reducedMotion) { paper.classList.add('permit-ready'); return; }
    // Restart the animations when the document is replayed.
    void paper.offsetWidth;
    paper.classList.add('permit-enter');
    const later = (delay: number, action: () => void) => {
      this.timers.push(window.setTimeout(action, delay));
    };
    later(620, () => paper.classList.add('permit-hit'));
    later(790, () => sound('stamp', 0));
    let at = 1060;
    [...TAGLINE].forEach((character, index) => {
      later(at, () => {
        paper.classList.add('permit-typing');
        text.textContent = TAGLINE.slice(0, index + 1);
        if (character !== ' ') sound('key', index);
      });
      at += character === ' ' ? 110 : character === '.' ? 160 : 55 + (index % 3) * 16;
    });
    later(at + 150, () => { paper.classList.remove('permit-typing'); paper.classList.add('permit-ready'); });
  }
}
