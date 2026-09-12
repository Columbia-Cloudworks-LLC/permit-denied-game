import { cashDigits, wheelDestination, wheelDigit } from './instrumentValues';

interface Wheel { reel: HTMLElement; position: number; start: number; target: number; since: number; digit: number }

export class CashCounter {
  private wheels: Wheel[] = [];
  private balance = 0;
  private initialized = false;
  private frame = 0;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private root: HTMLElement) {
    root.classList.add('cash-counter');
    root.setAttribute('role', 'img');
    document.addEventListener('visibilitychange', () => this.reset(this.balance));
    this.reduced.addEventListener('change', () => this.reset(this.balance));
  }

  reset(balance = 0): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.initialized = false;
    this.update(balance);
  }

  update(cash: number): void {
    const balance = Math.max(0, Math.floor(cash));
    if (this.initialized && balance === this.balance) return;
    const digits = cashDigits(balance);
    const immediate = !this.initialized || this.reduced.matches || document.hidden;
    const direction = balance >= this.balance ? 1 : -1;
    const now = performance.now();
    this.balance = balance;
    this.root.setAttribute('aria-label', `Cash: $${balance.toLocaleString('en-US')}`);
    // Preserve existing wheels when a new leading digit is required.
    if (this.wheels.length !== digits.length) {
      const previous = this.wheels;
      this.root.replaceChildren();
      const dollar = document.createElement('span');
      dollar.className = 'cash-symbol'; dollar.textContent = '$'; dollar.setAttribute('aria-hidden', 'true');
      this.root.append(dollar);
      this.wheels = [...digits].map((digit, i) => {
        if (i > 0 && (digits.length - i) % 3 === 0) {
          const comma = document.createElement('span'); comma.className = 'cash-comma'; comma.textContent = ',';
          comma.setAttribute('aria-hidden', 'true'); this.root.append(comma);
        }
        const old = previous[i - (digits.length - previous.length)];
        const shell = old?.reel.parentElement ?? document.createElement('span');
        shell.className = 'cash-wheel'; shell.setAttribute('aria-hidden', 'true');
        const reel = old?.reel ?? document.createElement('span'); reel.className = 'cash-reel';
        if (!old) shell.append(reel);
        this.root.append(shell);
        return old ?? { reel, position: immediate ? Number(digit) : 0, start: 0, target: 0, since: now, digit: -1 };
      });
    }
    this.wheels.forEach((wheel, i) => {
      const digit = Number(digits[i]);
      if (immediate) { wheel.position = wheel.start = wheel.target = digit; wheel.digit = digit; }
      else if (wheel.digit !== digit) {
        this.sample(wheel, now);
        wheel.start = wheel.position;
        wheel.target = wheelDestination(wheel.position, digit, direction);
        wheel.since = now; wheel.digit = digit;
      }
      this.draw(wheel);
    });
    this.initialized = true;
    if (!immediate && !this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private sample(wheel: Wheel, now: number): void {
    const progress = Math.min(1, (now - wheel.since) / 350);
    wheel.position = wheel.start + (wheel.target - wheel.start) * (1 - (1 - progress) ** 3);
  }

  private draw(wheel: Wheel): void {
    const whole = Math.floor(wheel.position), fraction = wheel.position - whole;
    const values = [-1, 0, 1].map(offset => wheelDigit(whole + offset));
    const signature = values.join('');
    if (wheel.reel.dataset.digits !== signature) {
      wheel.reel.innerHTML = values.map(value => `<span>${value}</span>`).join('');
      wheel.reel.dataset.digits = signature;
    }
    wheel.reel.style.transform = `translateY(${-100 * (1 + fraction) / 3}%)`;
  }

  private tick = (now: number): void => {
    this.frame = 0;
    let moving = false;
    for (const wheel of this.wheels) {
      this.sample(wheel, now); this.draw(wheel);
      moving ||= wheel.position !== wheel.target;
    }
    if (moving) this.frame = requestAnimationFrame(this.tick);
  };
}
