import { COPY, CASH_TARGET, MATCH_SECONDS, TITLE, TAGLINE } from "../game/constants";

export type OverlayMode = "none" | "pause" | "upgrade" | "results";

export interface HudState {
  cash: number;
  score: number;
  timeLeft: number;
  bladeDown: boolean;
  muted: boolean;
  heat: number;
  track: number;
  hintAlpha: number;
  overlay: OverlayMode;
  death: string | null;
  won: boolean;
}

export class Hud {
  readonly root: HTMLElement;
  private lastOverlay: OverlayMode | null = null;
  private lastDeath: string | null = null;
  private lastWon = false;
  private readonly cashEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly bladeEl: HTMLElement;
  private readonly heatEl: HTMLElement;
  private readonly heatBar: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly panel: HTMLElement;
  onMute?: () => void;
  onChoice?: (id: "blade" | "engine" | "push") => void;
  onResume?: () => void;
  onRestart?: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="top">
        <div>
          <div class="title">${TITLE}</div>
          <div class="tag">${TAGLINE}</div>
        </div>
        <div class="stat" id="hud-cash"></div>
        <div class="stat" id="hud-time"></div>
        <div class="stat" id="hud-score"></div>
        <button type="button" id="hud-mute">MUTE</button>
      </div>
      <div class="heat" id="hud-heat"><span></span></div>
      <div class="hint" id="hud-hint"></div>
      <div class="blade" id="hud-blade"></div>
      <div class="overlay" id="hud-overlay"><div class="panel" id="hud-panel"></div></div>
    `;
    this.cashEl = root.querySelector("#hud-cash")!;
    this.timeEl = root.querySelector("#hud-time")!;
    this.scoreEl = root.querySelector("#hud-score")!;
    this.hintEl = root.querySelector("#hud-hint")!;
    this.bladeEl = root.querySelector("#hud-blade")!;
    this.heatEl = root.querySelector("#hud-heat")!;
    this.heatBar = this.heatEl.querySelector("span")!;
    this.overlay = root.querySelector("#hud-overlay")!;
    this.panel = root.querySelector("#hud-panel")!;

    root.querySelector("#hud-mute")!.addEventListener("click", () => this.onMute?.());
    this.hintEl.innerHTML = `W/S drive &nbsp; A/D steer<br>SPACE powered blade &nbsp; R restart<br>ESC pause &nbsp; M mute &nbsp; V test car`;
  }

  render(s: HudState): void {
    this.cashEl.textContent = `CASH $${Math.floor(s.cash)} / $${CASH_TARGET}`;
    const t = Math.max(0, s.timeLeft);
    const m = Math.floor(t / 60);
    const sec = Math.floor(t % 60).toString().padStart(2, "0");
    this.timeEl.textContent = `${m}:${sec}`;
    this.scoreEl.textContent = `SCORE ${Math.floor(s.score)}`;
    this.bladeEl.textContent = s.bladeDown ? COPY.bladeDown : COPY.bladeUp;
    this.hintEl.style.opacity = String(s.hintAlpha);
    const stress = Math.max(s.heat, s.track);
    this.heatEl.style.opacity = stress > 18 ? "1" : "0";
    this.heatBar.style.width = `${Math.min(100, stress)}%`;
    const mute = this.root.querySelector("#hud-mute") as HTMLButtonElement;
    mute.textContent = s.muted ? "UNMUTE" : "MUTE";

    if (s.overlay === "none") {
      this.overlay.classList.remove("show");
      this.lastOverlay = "none";
      return;
    }
    this.overlay.classList.add("show");
    if (
      s.overlay === this.lastOverlay &&
      s.death === this.lastDeath &&
      s.won === this.lastWon &&
      this.panel.querySelector("button")
    ) {
      return;
    }
    this.lastOverlay = s.overlay;
    this.lastDeath = s.death;
    this.lastWon = s.won;
    if (s.overlay === "pause") {
      this.panel.innerHTML = `
        <h2>HOLD IT</h2>
        <p>County clock is still running when you come back. R restarts. ESC resumes.</p>
        <div class="choices">
          <button type="button" data-act="resume">RESUME</button>
          <button type="button" data-act="restart">RESTART</button>
        </div>`;
    } else if (s.overlay === "upgrade") {
      this.panel.innerHTML = `
        <h2>COUNTY SURPLUS</h2>
        <p>Cash milestone. Pick one. Action is paused.</p>
        <div class="choices">
          <button type="button" data-up="blade">STRONGER BLADE</button>
          <button type="button" data-up="engine">MORE ENGINE</button>
          <button type="button" data-up="push">FASTER PUSH</button>
        </div>`;
    } else {
      const headline = s.won ? "PERMIT DENIED" : (s.death ?? "COUNTY CLOCK");
      const line = s.won
        ? "The lot is quieter. The county still wants a word."
        : "The clock, the engine, or the tracks called it.";
      this.panel.innerHTML = `
        <h2>${headline}</h2>
        <p>${line}</p>
        <p>CASH $${Math.floor(s.cash)} &nbsp; SCORE ${Math.floor(s.score)} &nbsp; TIME ${formatTime(MATCH_SECONDS - s.timeLeft)}</p>
        <div class="choices">
          <button type="button" data-act="restart">RUN IT AGAIN</button>
        </div>`;
    }
    this.panel.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const up = (btn as HTMLButtonElement).dataset.up as "blade" | "engine" | "push" | undefined;
        const act = (btn as HTMLButtonElement).dataset.act;
        if (up) this.onChoice?.(up);
        if (act === "resume") this.onResume?.();
        if (act === "restart") this.onRestart?.();
      });
    });
  }
}

function formatTime(used: number): string {
  const t = Math.max(0, used);
  return `${Math.floor(t / 60)}:${Math.floor(t % 60)
    .toString()
    .padStart(2, "0")}`;
}
