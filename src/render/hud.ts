import { COPY, CASH_TARGET, MATCH_SECONDS, TITLE, TAGLINE } from "../game/constants";
import { DISTRICT_LABELS, type DistrictId, type SessionKind } from "../game/session";

export type OverlayMode = "none" | "pause" | "upgrade" | "results";

export interface HudState {
  cash: number;
  score: number;
  timeLeft: number;
  elapsed: number;
  session: SessionKind;
  district: DistrictId;
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
  onNewSeed?: () => void;
  onSession?: (kind: SessionKind) => void;
  onDistrict?: (id: DistrictId) => void;

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
      <div class="session" id="hud-session"></div>
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
    this.hintEl.innerHTML = `W/S drive &nbsp; A/D steer<br>SPACE powered blade &nbsp; R same lot<br>N new seed &nbsp; 1/2/3 upgrades<br>ESC pause &nbsp; M mute &nbsp; V test car`;
    this.bindSessionBar();
  }

  private bindSessionBar(): void {
    const bar = this.root.querySelector("#hud-session")!;
    bar.innerHTML = `
      <button type="button" data-session="challenge">CLOCK</button>
      <button type="button" data-session="sandbox">SANDBOX</button>
      <button type="button" data-district="classic">${DISTRICT_LABELS.classic}</button>
      <button type="button" data-district="d10">${DISTRICT_LABELS.d10}</button>
      <button type="button" data-district="d30">${DISTRICT_LABELS.d30}</button>
      <button type="button" data-district="d100">${DISTRICT_LABELS.d100}</button>
      <button type="button" data-act="newseed">NEW LOT</button>
      <button type="button" data-up="blade">BLADE+</button>
      <button type="button" data-up="engine">ENGINE+</button>
      <button type="button" data-up="push">PUSH+</button>
    `;
    bar.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const session = (btn as HTMLButtonElement).dataset.session as SessionKind | undefined;
        const district = (btn as HTMLButtonElement).dataset.district as DistrictId | undefined;
        const act = (btn as HTMLButtonElement).dataset.act;
        const up = (btn as HTMLButtonElement).dataset.up as "blade" | "engine" | "push" | undefined;
        if (session) this.onSession?.(session);
        if (district) this.onDistrict?.(district);
        if (act === "newseed") this.onNewSeed?.();
        if (up) this.onChoice?.(up);
      });
    });
  }

  render(s: HudState): void {
    this.cashEl.textContent =
      s.session === "sandbox" ? `CASH $${Math.floor(s.cash)}` : `CASH $${Math.floor(s.cash)} / $${CASH_TARGET}`;
    if (s.session === "sandbox") {
      this.timeEl.textContent = `LOT ${formatTime(s.elapsed)}`;
    } else {
      this.timeEl.textContent = formatTime(Math.max(0, s.timeLeft));
    }
    this.paintSessionBar(s.session, s.district);
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
      const pauseLine =
        s.session === "sandbox"
          ? "Sandbox stays open. R restarts this layout. N rolls a new seed. ESC resumes."
          : "County clock is still running when you come back. R restarts. ESC resumes.";
      this.panel.innerHTML = `
        <h2>HOLD IT</h2>
        <p>${pauseLine}</p>
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
        if (act === "newseed") this.onNewSeed?.();
      });
    });
  }

  private paintSessionBar(session: SessionKind, district: DistrictId): void {
    const bar = this.root.querySelector("#hud-session");
    if (!bar) return;
    bar.querySelectorAll("button").forEach((btn) => {
      const el = btn as HTMLButtonElement;
      el.classList.toggle("on", el.dataset.session === session || el.dataset.district === district);
    });
  }
}

function formatTime(used: number): string {
  const t = Math.max(0, used);
  return `${Math.floor(t / 60)}:${Math.floor(t % 60)
    .toString()
    .padStart(2, "0")}`;
}
