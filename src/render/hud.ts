import { COPY, CASH_TARGET, MATCH_SECONDS, TITLE, TAGLINE } from "../game/constants";
import { DEBUG_GROUPS, type DebugView, type DebugToggle } from "../debug/view";
import { DISTRICT_LABELS, type DistrictId, type SessionKind, type DemoAsset } from "../game/session";

export type OverlayMode = "none" | "pause" | "upgrade" | "results";

export interface HudState {
  job?: { progress: number; remaining: number; instruction: string; paid: boolean; payout: number };
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
  onDemo?: (id: DemoAsset) => void;
  onJob?: () => void;
  onDrive?: (key: string, down: boolean) => void;
  onDebugToggle?: (key: DebugToggle, value: boolean) => void;
  onDebugFloor?: (floor: number) => void;
  onDebugReset?: () => void;
  onDebugStep?: () => void;
  onDebugOpen?: () => void;

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
      <div id="hud-job" class="job" hidden></div>
      <div class="debug-menu">
        <button type="button" id="debug-toggle" aria-expanded="false" aria-controls="debug-panel">DEBUG</button>
        <section id="debug-panel" aria-label="Game debug options" hidden>
          <div class="debug-heading"><strong>SCENE INSPECTOR</strong><button type="button" id="debug-close" aria-label="Close debug menu">×</button></div>
          <p>Visibility only: hidden objects still collide and simulate. Options stay set when you restart a lot.</p>
          <label class="debug-floor">Show floors <select id="debug-floor" aria-label="Show floors">
            <option value="99">All floors</option><option value="0">Ground floor only</option>
            <option value="1">Through second floor</option><option value="2">Through third floor</option>
          </select></label>
          ${DEBUG_GROUPS.map(group => `<fieldset><legend>${group.label}</legend>${group.options.map(([key, label, checked]) =>
            `<label><input type="checkbox" data-debug="${key}" ${checked ? "checked" : ""}> ${label}</label>`).join("")}</fieldset>`).join("")}
          <div class="debug-actions"><button type="button" id="debug-step" disabled>STEP 1 FRAME</button><button type="button" id="debug-reset">RESET OPTIONS</button></div>
          <p class="debug-legend">Paths: blue · route: yellow · lots: green · buildable: purple · rooms: gold<br>Collision: pink walls, orange props/contents, white dozer · supports: green live / pink failing</p>
        </section>
      </div>
      <div class="heat" id="hud-heat"><span></span></div>
      <div class="hint" id="hud-hint"></div>
      <div class="blade" id="hud-blade"></div>
      <div id="drive-pad" aria-label="Driving controls" hidden>
        <button data-drive="w">FORWARD</button><button data-drive="s">REVERSE</button>
        <button data-drive="a">LEFT</button><button data-drive="d">RIGHT</button>
        <button data-drive=" ">POWER BLADE</button><button data-drive="stop">STOP</button>
      </div>
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
    this.hintEl.innerHTML = `W/S drive &nbsp; A/D steer<br>Hold SPACE: powered blade<br>ESC pause &nbsp; R replay &nbsp; M mute`;
    this.bindSessionBar();
    this.bindDebugMenu();
    const pad = root.querySelector<HTMLElement>("#drive-pad")!;
    pad.hidden = new URLSearchParams(window.location.search).get("controls") !== "1";
    pad.querySelectorAll<HTMLButtonElement>("button").forEach(btn => btn.addEventListener("click", () => {
      const key = btn.dataset.drive!;
      if (key === "stop") {
        pad.querySelectorAll<HTMLButtonElement>("[data-drive]").forEach(b => {
          b.setAttribute("aria-pressed", "false"); this.onDrive?.(b.dataset.drive!, false);
        });
      } else {
        const down = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", String(down)); this.onDrive?.(key, down);
      }
    }));
  }

  private bindDebugMenu(): void {
    const panel = this.root.querySelector<HTMLElement>("#debug-panel")!;
    const toggle = this.root.querySelector<HTMLButtonElement>("#debug-toggle")!;
    const show = (open: boolean) => {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) this.onDebugOpen?.();
    };
    toggle.addEventListener("click", () => show(panel.hidden));
    this.root.querySelector("#debug-close")!.addEventListener("click", () => { show(false); toggle.focus(); });
    this.root.querySelector(".debug-menu")!.addEventListener("keydown", event => {
      if ((event as KeyboardEvent).key === "Escape" && !panel.hidden) { event.stopPropagation(); show(false); toggle.focus(); }
    });
    panel.querySelectorAll<HTMLInputElement>("[data-debug]").forEach(input => {
      input.addEventListener("change", () => this.onDebugToggle?.(input.dataset.debug as DebugToggle, input.checked));
    });
    this.root.querySelector<HTMLSelectElement>("#debug-floor")!.addEventListener("change", event => {
      this.onDebugFloor?.(Number((event.target as HTMLSelectElement).value));
    });
    this.root.querySelector("#debug-reset")!.addEventListener("click", () => this.onDebugReset?.());
    this.root.querySelector("#debug-step")!.addEventListener("click", () => this.onDebugStep?.());
  }

  syncDebug(view: DebugView): void {
    this.root.querySelectorAll<HTMLInputElement>("[data-debug]").forEach(input => {
      input.checked = view[input.dataset.debug as DebugToggle];
    });
    this.root.querySelector<HTMLSelectElement>("#debug-floor")!.value = String(view.maxFloor);
    this.root.querySelector<HTMLButtonElement>("#debug-step")!.disabled = !view.freeze;
    this.root.querySelector<HTMLButtonElement>("#debug-toggle")!.textContent = view.freeze ? "DEBUG · FROZEN" : "DEBUG";
  }

  private bindSessionBar(): void {
    const bar = this.root.querySelector("#hud-session")!;
    bar.innerHTML = `
      <button type="button" data-session="challenge">CLOCK</button>
      <button type="button" data-session="sandbox">SANDBOX</button>
      <button type="button" data-act="job">BRICK JOB</button>
      <button type="button" data-district="classic">${DISTRICT_LABELS.classic}</button>
      <button type="button" data-district="d10">${DISTRICT_LABELS.d10}</button>
      <button type="button" data-district="d30">${DISTRICT_LABELS.d30}</button>
      <button type="button" data-district="d100">${DISTRICT_LABELS.d100}</button>
      <button type="button" data-act="newseed">NEW LOT</button>
      <button type="button" data-demo="ranch">RANCH</button>
      <button type="button" data-demo="rivertown">BRICK</button>
      <button type="button" data-demo="steel-warehouse">STEEL</button>
      <button type="button" data-up="blade">BLADE+</button>
      <button type="button" data-up="engine">ENGINE+</button>
      <button type="button" data-up="push">PUSH+</button>
    `;
    bar.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const session = (btn as HTMLButtonElement).dataset.session as SessionKind | undefined;
        const district = (btn as HTMLButtonElement).dataset.district as DistrictId | undefined;
        const act = (btn as HTMLButtonElement).dataset.act;
        const demo = (btn as HTMLButtonElement).dataset.demo as DemoAsset | undefined;
        const up = (btn as HTMLButtonElement).dataset.up as "blade" | "engine" | "push" | undefined;
        if (session) this.onSession?.(session);
        if (district) this.onDistrict?.(district);
        if (demo) this.onDemo?.(demo);
        if (act === "newseed") this.onNewSeed?.();
        if (act === "job") this.onJob?.();
        if (up) this.onChoice?.(up);
      });
    });
  }

  render(s: HudState): void {
    const job = this.root.querySelector<HTMLElement>("#hud-job")!;
    job.hidden = !s.job;
    if (s.job) job.textContent = s.job.paid
      ? `JOB ACCEPTED · +$${s.job.payout} paid · R replay or continue clearing the site`
      : `BRICK / DEMOLITION ORDER · ${Math.floor(s.job.progress * 100)}%\n${s.job.instruction}\nRemove 90% of the structure. Loose rubble may stay.`;
    this.root.querySelectorAll<HTMLButtonElement>("[data-demo], #hud-session [data-up]").forEach(el => {
      el.hidden = s.session !== "sandbox";
    });
    this.cashEl.textContent =
      s.session === "sandbox" || s.job ? `CASH $${Math.floor(s.cash)}` : `CASH $${Math.floor(s.cash)} / $${CASH_TARGET}`;
    if (s.session === "sandbox" || s.job) {
      this.timeEl.textContent = `LOT ${formatTime(s.elapsed)}`;
    } else {
      this.timeEl.textContent = formatTime(Math.max(0, s.timeLeft));
    }
    this.paintSessionBar(s.session, s.district);
    this.scoreEl.textContent = `SCORE ${Math.floor(s.score)}`;
    this.bladeEl.textContent = `${s.bladeDown ? COPY.bladeDown : COPY.bladeUp}\nHEAT ${Math.round(s.heat)}%${s.heat > 65 ? " · RELEASE BLADE" : ""}\nTRACKS ${Math.round(s.track)}%${s.track > 65 ? " · BACK OFF RUBBLE" : ""}`;
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
        <h2>${s.job ? "DEMOLITION ACCEPTED" : "COUNTY SURPLUS"}</h2>
        <p>${s.job ? `Contract paid: +$${s.job.payout}. One earned upgrade. Choose, then continue at the site.` : "Cash milestone. Pick one. Action is paused."}</p>
        <div class="choices">
          <button type="button" data-up="blade">1 · BLADE +42%<br>Break masonry faster</button>
          <button type="button" data-up="engine">2 · ENGINE +28%<br>More speed and acceleration</button>
          <button type="button" data-up="push">3 · PUSH +35%<br>Longer powered shove</button>
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
