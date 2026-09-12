import { TAGLINE } from '../game/constants';
import { PermitIntro, permitDocument, type PermitSound } from './permitIntro';

export class PermitLogo {
  readonly root = document.createElement('div');
  private intro = new PermitIntro();
  private timer = 0;
  private paper: HTMLElement;
  private button: HTMLButtonElement;
  private label: HTMLElement;
  private status: HTMLElement;

  constructor(charge: () => number | null, sound: (kind: PermitSound, index: number) => void, unlock: () => Promise<void>) {
    this.root.className = 'permit-logo';
    this.root.innerHTML = `<button type="button" class="permit-logo-button" aria-label="Resubmit Application — spends cash">
      ${permitDocument(false)}
      <span class="resubmit-offer"><svg class="cash-wad" viewBox="0 0 120 65" aria-hidden="true"><g transform="rotate(-12 60 32)"><path d="M8 18h98v42H8z" fill="#637952" stroke="#243c2b" stroke-width="3"/><path d="M8 24h98M8 30h98M8 36h98M8 42h98M8 48h98M8 54h98" stroke="#acb48c"/><rect x="12" y="7" width="98" height="40" rx="2" fill="#bcc6a0" stroke="#314e37" stroke-width="3"/><rect x="18" y="12" width="86" height="30" fill="none" stroke="#526b45" stroke-width="2"/><ellipse cx="61" cy="27" rx="16" ry="13" fill="#738960"/><text x="61" y="35" text-anchor="middle" fill="#e0e2bf" font-size="23" font-family="serif">$</text><text x="23" y="31" fill="#314e37" font-size="12">100</text><path d="M74 6h13v43H74z" fill="#d7c7a3" stroke="#998962"/></g></svg><span data-offer>Resubmit Application</span></span>
      </button><span class="resubmit-status" role="status"></span>`;
    this.paper = this.root.querySelector('.permit-paper')!;
    this.button = this.root.querySelector('button')!;
    this.label = this.root.querySelector('[data-offer]')!;
    this.status = this.root.querySelector('[role="status"]')!;
    this.reset();
    this.button.addEventListener('click', () => {
      const fee = charge();
      if (fee === null) return;
      void unlock().catch(() => {});
      this.root.classList.add('resubmitting');
      this.status.textContent = `Processing fee: −$${fee}.`;
      this.intro.play(this.paper, sound, matchMedia('(prefers-reduced-motion: reduce)').matches);
      this.timer = window.setTimeout(() => {
        this.root.classList.remove('resubmitting');
        this.status.textContent = `Processing fee: −$${fee}. ${TAGLINE} Re-apply In 6 Months.`;
      }, 4300);
    });
  }

  reset(): void {
    clearTimeout(this.timer);
    this.intro.stop();
    this.root.classList.remove('resubmitting');
    this.paper.classList.add('permit-ready');
    this.paper.querySelector('[data-typed-verdict]')!.textContent = TAGLINE;
    this.status.textContent = '';
  }

  render(used: boolean, cash: number, modal: boolean): void {
    const text = used ? 'Re-apply In 6 Months' : cash < 1 ? 'Insufficient Cash' : 'Resubmit Application';
    this.label.textContent = text;
    this.button.setAttribute('aria-label', used || cash < 1 ? text : `${text} — spends cash`);
    this.button.setAttribute('aria-disabled', String(used || cash < 1 || modal));
    this.root.classList.toggle('resubmission-used', used);
    if (modal && this.root.classList.contains('resubmitting')) this.reset();
  }
}
