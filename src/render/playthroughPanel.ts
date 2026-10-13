import type { Playthrough } from "../debug/playthrough";
import type { PlaythroughStatus } from "../game/playthroughRun";

export interface PlaythroughPanelActions {
  record(): void;
  stop(): void;
  replayLast(): void;
  load(text: string): void;
  save(): void;
  togglePause(): void;
  restart(): void;
  perf(): void;
}

function clock(steps: number): string {
  const seconds = Math.floor(steps / 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Replay progress and the verdict once every recorded step has run. */
export function playthroughLabel(status: PlaythroughStatus): string {
  if (status.state === "recording") return `REC ${clock(status.step)}`;
  if (status.state !== "replaying") return "";
  const verdict = status.drift === null ? (status.paused ? " · PAUSED" : "") : status.drift.length ? " · DRIFT" : " · MATCH";
  return `REPLAY ${clock(status.step)} / ${clock(status.steps)}${verdict}`;
}

function playthroughFileName(playthrough: Playthrough): string {
  const site = playthrough.rules.level ?? playthrough.rules.district;
  return `permit-denied-${playthrough.rules.kind}-${site}-${playthrough.rules.seed}-${playthrough.steps}.json`;
}

export function downloadPlaythrough(playthrough: Playthrough): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(playthrough)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = playthroughFileName(playthrough);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Record/replay buttons in the Debug binder, and the badge that stays on screen during capture or replay. */
export class PlaythroughPanel {
  private readonly row: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly file: HTMLInputElement;
  private readonly recordButton: HTMLButtonElement;
  private rendered = "";

  constructor(hudRoot: HTMLElement, private readonly actions: PlaythroughPanelActions) {
    this.row = document.createElement("div");
    this.row.className = "debug-playthrough";
    this.row.innerHTML = `
      <div class="debug-playthrough-buttons">
        <button type="button" data-pt="record">Record Playthrough</button>
        <button type="button" data-pt="replay">Replay Last</button>
        <button type="button" data-pt="load">Load Replay…</button>
        <button type="button" data-pt="save">Save File</button>
        <input type="file" accept="application/json,.json" hidden>
      </div>
      <p class="fine-print" data-pt-note role="status"></p>`;
    // Inside the scrolling pages, so the fixed binder header stays short on small phones.
    hudRoot.querySelector("#debug-panel .debug-pages")!.prepend(this.row);
    this.file = this.row.querySelector("input[type=file]")!;
    this.recordButton = this.row.querySelector("[data-pt=record]")!;
    this.badge = document.createElement("div");
    this.badge.id = "playthrough-badge";
    this.badge.setAttribute("role", "status");
    this.badge.hidden = true;
    this.badge.innerHTML = `<i aria-hidden="true"></i><span data-pt-label></span>
      <button type="button" data-pt="toggle">Pause</button><button type="button" data-pt="restart">Restart</button>
      <button type="button" data-pt="perf">Perf</button><button type="button" data-pt="stop">Stop</button>`;
    hudRoot.append(this.badge);
    for (const button of [...this.row.querySelectorAll<HTMLButtonElement>("[data-pt]"), ...this.badge.querySelectorAll<HTMLButtonElement>("[data-pt]")]) {
      button.addEventListener("click", () => this.click(button.dataset.pt!));
    }
    this.file.addEventListener("change", () => {
      const chosen = this.file.files?.[0];
      this.file.value = "";
      if (chosen) void chosen.text().then(text => this.actions.load(text));
    });
  }

  private click(action: string): void {
    const run: Record<string, () => void> = {
      record: () => this.actions.record(),
      stop: () => this.actions.stop(),
      replay: () => this.actions.replayLast(),
      load: () => this.file.click(),
      save: () => this.actions.save(),
      toggle: () => this.actions.togglePause(),
      restart: () => this.actions.restart(),
      perf: () => this.actions.perf(),
    };
    run[action]?.();
    if (action !== "load" && action !== "save") document.querySelector<HTMLCanvasElement>("#game-root canvas")?.focus();
  }

  render(status: PlaythroughStatus): void {
    const key = JSON.stringify(status);
    if (key === this.rendered) return;
    this.rendered = key;
    const recording = status.state === "recording", replaying = status.state === "replaying";
    const record = this.recordButton;
    record.textContent = recording ? "Stop Recording" : replaying ? "Exit Replay" : "Record Playthrough";
    record.dataset.pt = recording || replaying ? "stop" : "record";
    for (const id of ["replay", "save"]) this.row.querySelector<HTMLButtonElement>(`[data-pt=${id}]`)!.disabled = !status.hasLast || recording;
    this.row.querySelector<HTMLButtonElement>("[data-pt=load]")!.disabled = recording;
    this.row.querySelector("[data-pt-note]")!.textContent = status.note;
    this.badge.hidden = status.state === "idle";
    this.badge.dataset.state = status.state;
    this.badge.querySelector("[data-pt-label]")!.textContent = playthroughLabel(status);
    for (const id of ["toggle", "restart", "perf"]) this.badge.querySelector<HTMLButtonElement>(`[data-pt=${id}]`)!.hidden = !replaying;
    this.badge.querySelector<HTMLButtonElement>("[data-pt=toggle]")!.textContent = status.paused ? "Play" : "Pause";
    this.badge.querySelector<HTMLButtonElement>("[data-pt=stop]")!.textContent = replaying ? "Exit" : "Stop";
  }
}
