import { TAGLINE } from '../game/constants';
import { PermitIntro, permitDocument, type PermitSound } from './permitIntro';

export class PermitLogo {
  readonly root = document.createElement('div');
  private intro = new PermitIntro();
  private timer = 0;
  private returnAnimation?: Animation;
  private stampReturnAnimation?: Animation;
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
    this.button.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'touch' && !this.root.classList.contains('resubmitting')) {
        this.root.classList.add('offer-hovered');
      }
    });
    this.button.addEventListener('pointerleave', () => this.root.classList.remove('offer-hovered'));
    this.button.addEventListener('pointercancel', () => this.root.classList.remove('offer-hovered'));
    this.button.addEventListener('click', () => {
      const fee = charge();
      if (fee === null) return;
      this.root.classList.remove('offer-hovered');
      void unlock().catch(() => {});
      this.root.classList.add('resubmitting');
      this.status.textContent = `Processing fee: −$${fee}.`;
      this.intro.play(this.paper, sound, matchMedia('(prefers-reduced-motion: reduce)').matches);
      this.timer = window.setTimeout(() => {
        this.returnToLogo(fee);
      }, 4300);
    });
  }

  private returnToLogo(fee: number): void {
    const finish = () => {
      this.root.classList.remove('resubmitting', 'permit-returning', 'offer-hovered');
      this.status.textContent = `Processing fee: −$${fee}. ${TAGLINE} Re-apply In 6 Months.`;
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }

    const slot = this.paper.parentElement!;
    const stamp = this.paper.querySelector<HTMLElement>('.permit-stamp')!;
    const stampStyle = getComputedStyle(stamp);
    const expandedStamp = { fontSize: stampStyle.fontSize, top: stampStyle.top };
    const origin = slot.getBoundingClientRect();
    const expanded = this.paper.getBoundingClientRect();
    // Measure the actual responsive logo position, restoring the large layout before paint.
    this.root.classList.remove('resubmitting');
    const compact = this.paper.getBoundingClientRect();
    const compactStampStyle = getComputedStyle(stamp);
    const compactStamp = { fontSize: compactStampStyle.fontSize, top: compactStampStyle.top };
    this.root.classList.add('resubmitting', 'permit-returning');
    const scale = compact.width / expanded.width;
    const x = compact.left - origin.left - (expanded.left - origin.left) * scale;
    const y = compact.top - origin.top - (expanded.top - origin.top) * scale;
    const timing: KeyframeAnimationOptions = { duration: 520, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' };
    const animation = slot.animate([
      { transformOrigin: '0 0', transform: 'translate(0, 0) scale(1)' },
      { transformOrigin: '0 0', transform: `translate(${x}px, ${y}px) scale(${scale})` },
    ], timing);
    this.stampReturnAnimation = stamp.animate([expandedStamp, compactStamp], timing);
    this.returnAnimation = animation;
    void animation.finished.then(() => {
      if (this.returnAnimation !== animation) return;
      finish();
      animation.cancel();
      this.stampReturnAnimation?.cancel();
      this.stampReturnAnimation = undefined;
      this.returnAnimation = undefined;
    }).catch(() => { /* Reset cancels an in-progress return. */ });
  }

  reset(): void {
    clearTimeout(this.timer);
    this.returnAnimation?.cancel();
    this.returnAnimation = undefined;
    this.stampReturnAnimation?.cancel();
    this.stampReturnAnimation = undefined;
    this.intro.stop();
    this.root.classList.remove('resubmitting', 'permit-returning', 'offer-hovered');
    this.paper.classList.add('permit-ready');
    this.paper.querySelector('[data-typed-verdict]')!.textContent = TAGLINE;
    this.status.textContent = '';
  }

  render(used: boolean, cash: number, modal: boolean): void {
    const text = used ? 'Re-apply In\n6 Months' : cash < 1 ? 'Insufficient\nCash' : 'Resubmit\nApplication';
    this.label.textContent = text;
    const accessibleText = text.replace('\n', ' ');
    this.button.setAttribute('aria-label', used || cash < 1 ? accessibleText : `${accessibleText} — spends cash`);
    this.button.setAttribute('aria-disabled', String(used || cash < 1 || modal));
    this.root.classList.toggle('resubmission-used', used);
    if (modal && this.root.classList.contains('resubmitting')) this.reset();
  }
}
