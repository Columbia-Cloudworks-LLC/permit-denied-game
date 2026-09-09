import { Application } from "pixi.js";
import { AudioBus } from "../audio/synth";
import { CameraShake } from "../fx/cameraShake";
import { ParticlePool } from "../fx/particles";
import { Hud } from "../render/hud";
import { WorldRenderer } from "../render/WorldRenderer";
import { obstructionAt } from "../sim/debris";
import { stepWorld, type Upgrades } from "../sim/worldSim";
import type { Bird, WorldEvent } from "../structure/types";
import { createDozer, dozerSpeed, stepDozer } from "../vehicle/dozer";
import { createRoadVehicle } from "../vehicle/roadVehicle";
import { worldToScreen } from "../world/iso";
import { createTown } from "../world/town";
import {
  CASH_TARGET,
  COPY,
  MATCH_SECONDS,
  SIM_DT,
  SIM_MAX_STEPS,
  TITLE,
  UPGRADE_MILESTONES,
} from "./constants";
import { Input } from "./input";
import { lerp } from "./math";

export type GameMode = "play" | "pause" | "upgrade" | "results";

export class Game {
  private app!: Application;
  private readonly input = new Input();
  private readonly audio = new AudioBus();
  private readonly particles = new ParticlePool();
  private readonly shake = new CameraShake();
  private readonly renderer = new WorldRenderer();
  private hud!: Hud;
  private town = createTown();
  private dozer = createDozer(20.6, 27.2, -Math.PI / 2);
  private birds: Bird[] = [];
  private cash = 0;
  private score = 0;
  private timeLeft = MATCH_SECONDS;
  private hint = 1;
  private mode: GameMode = "play";
  private death: string | null = null;
  private upgrades: Upgrades = { blade: 0, engine: 0, push: 0 };
  private nextUpgrade = 0;
  private acc = 0;
  private grindAud = 0;
  private scrapeCd = 0;
  private detachInput: (() => void) | null = null;

  async start(root: HTMLElement, hudRoot: HTMLElement): Promise<void> {
    document.title = TITLE;
    this.app = new Application();
    await this.app.init({
      resizeTo: root,
      background: 0x1a1810,
      antialias: false,
      roundPixels: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
    });
    root.appendChild(this.app.canvas);
    this.app.stage.addChild(this.renderer.root);
    this.hud = new Hud(hudRoot);
    this.hud.onMute = () => {
      void this.audio.unlock();
      this.audio.toggleMute();
    };
    this.hud.onChoice = (id) => this.pickUpgrade(id);
    this.hud.onResume = () => {
      if (this.mode === "pause") this.mode = "play";
    };
    this.hud.onRestart = () => this.reset();
    this.detachInput = this.input.attach();
    this.reset();
    (window as unknown as { __pd: Game }).__pd = this;
    this.app.ticker.add((ticker) => {
      this.frame(Math.min(0.05, ticker.deltaMS / 1000));
    });
  }

  snapshot(): {
    cash: number;
    score: number;
    timeLeft: number;
    mode: GameMode;
    dozer: { x: number; y: number; heading: number };
    rubble: number;
    marks: number;
    roadCar: { x: number; y: number } | null;
    buildings: { name: string; states: Record<string, number> }[];
  } {
    return {
      cash: this.cash,
      score: this.score,
      timeLeft: this.timeLeft,
      mode: this.mode,
      dozer: { x: this.dozer.x, y: this.dozer.y, heading: this.dozer.heading },
      rubble: this.town.rubble.length,
      marks: this.town.marks.length,
      roadCar: this.town.roadCar
        ? { x: this.town.roadCar.x, y: this.town.roadCar.y }
        : null,
      buildings: this.town.buildings.map((b) => {
        const states: Record<string, number> = {};
        for (const c of b.cells) states[c.state] = (states[c.state] ?? 0) + 1;
        return { name: b.name, states };
      }),
    };
  }

  reset(): void {
    this.town = createTown();
    this.dozer = createDozer(this.town.spawnX, this.town.spawnY, this.town.spawnHeading);
    this.particles.clear();
    this.birds = [];
    this.cash = 0;
    this.score = 0;
    this.timeLeft = MATCH_SECONDS;
    this.hint = 1;
    this.mode = "play";
    this.death = null;
    this.upgrades = { blade: 0, engine: 0, push: 0 };
    this.nextUpgrade = 0;
    this.acc = 0;
    this.grindAud = 0;
    this.scrapeCd = 0;
    const spawn = worldToScreen(this.dozer.x, this.dozer.y, 0);
    this.renderer.camX = spawn.x;
    this.renderer.camY = spawn.y;
  }

  private pickUpgrade(id: "blade" | "engine" | "push"): void {
    this.upgrades[id] += 1;
    this.mode = "play";
  }

  private frame(realDt: number): void {
    if (this.input.consume("m") || this.input.consume("M")) {
      void this.audio.unlock();
      this.audio.toggleMute();
    }
    if (this.input.consume("r") || this.input.consume("R")) this.reset();
    if (this.input.consume("v") || this.input.consume("V")) this.spawnRoadVehicle();
    if (this.input.consume("Escape")) {
      if (this.mode === "play") this.mode = "pause";
      else if (this.mode === "pause") this.mode = "play";
    }
    if (this.input.down.size > 0) void this.audio.unlock();

    if (this.mode === "play") {
      this.acc += realDt;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < SIM_MAX_STEPS) {
        this.step(SIM_DT);
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === SIM_MAX_STEPS) this.acc = 0;
    } else {
      this.acc = 0;
      this.input.flush();
      this.audio.hush();
    }

    this.draw(realDt);
  }

  private step(dt: number): void {
    const drive = this.input.axis();
    stepDozer(
      this.dozer,
      {
        throttle: drive.throttle,
        steer: drive.steer,
        blade: this.input.blade(),
        engineMul: 1 + this.upgrades.engine * 0.28,
        bladeMul: 1 + this.upgrades.blade * 0.42,
        pushMul: 1 + this.upgrades.push * 0.35,
      },
      dt,
    );

    const beforeHeat = this.dozer.heat;
    const out = stepWorld(this.town, this.dozer, this.particles, this.upgrades, dt);
    this.cash += out.cash;
    this.score += out.score;
    this.react(out.events);
    for (const b of out.birds) {
      this.birds.push({
        x: b.x,
        y: b.y,
        z: 2.4,
        vx: 3.8,
        vy: -2.2,
        vz: 2.4,
        life: 2.8,
      });
    }

    for (const bird of this.birds) {
      bird.x += bird.vx * dt;
      bird.y += bird.vy * dt;
      bird.z += bird.vz * dt;
      bird.vz -= 1.2 * dt;
      bird.life -= dt;
    }
    this.birds = this.birds.filter((b) => b.life > 0);

    this.timeLeft -= dt;
    this.hint = Math.max(0, this.hint - dt * 0.12);
    this.scrapeCd = Math.max(0, this.scrapeCd - dt);
    const pushing = this.dozer.bladeDown && out.debrisLoad > 0.2;
    this.grindAud = lerp(
      this.grindAud,
      this.dozer.bladeDown && (this.dozer.heat > beforeHeat - 0.01 || pushing) ? 0.14 + Math.min(0.1, out.debrisLoad * 0.04) : 0,
      1 - Math.pow(0.001, dt),
    );
    this.audio.engineLevel(dozerSpeed(this.dozer), this.dozer.heat);
    this.audio.grindLevel(this.dozer.bladeDown ? 0.08 + this.grindAud : 0);

    if (this.nextUpgrade < UPGRADE_MILESTONES.length && this.cash >= UPGRADE_MILESTONES[this.nextUpgrade]!) {
      this.nextUpgrade += 1;
      this.mode = "upgrade";
      return;
    }

    if (this.dozer.heat >= 100) this.finish(COPY.engineCooked, false);
    else if (this.dozer.track >= 100) this.finish(COPY.trackThrown, false);
    else if (this.timeLeft <= 0) this.finish(COPY.countyClock, this.cash >= CASH_TARGET);
  }

  private finish(death: string, won: boolean): void {
    this.mode = "results";
    this.death = won ? null : death;
    if (won) this.death = null;
  }

  private react(events: WorldEvent[]): void {
    for (const e of events) {
      if (e.kind === "impact" || e.kind === "breach") {
        this.shake.punch(e.mag);
        this.audio.impact(e.mag);
        if (e.kind === "breach") this.audio.breakMat(e.mag);
      }
      if (e.kind === "collapse") {
        this.shake.punch(e.mag * 1.4);
        this.audio.collapse(e.mag);
      }
      if (e.kind === "cash") this.audio.cash();
      if (e.kind === "chip" && e.mag > 0.5) this.audio.impact(0.3);
      if (e.kind === "scrape" && this.scrapeCd <= 0) {
        this.scrapeCd = 0.08;
        if (e.material === "metal" || e.material === "wood") this.audio.clatter(e.mag, e.material);
        else this.audio.scrape(e.mag, e.material);
      }
      if (e.kind === "crush") {
        this.audio.crunch(e.mag);
        if (e.mag > 0.9) this.shake.punch(e.mag * 0.45);
      }
    }
  }

  spawnRoadVehicle(): void {
    this.town.roadCar = createRoadVehicle();
  }

  obstructionAt(x: number, y: number, radius = 0.7) {
    return obstructionAt(this.town, x, y, radius);
  }

  private draw(dt: number): void {
    const focus = worldToScreen(this.dozer.x, this.dozer.y, 0.4);
    this.renderer.camX += (focus.x - this.renderer.camX) * (1 - Math.exp(-6 * dt));
    this.renderer.camY += (focus.y - this.renderer.camY) * (1 - Math.exp(-6 * dt));
    const shake = this.mode === "play" ? this.shake.step(dt) : { x: 0, y: 0 };
    this.renderer.layout(this.app.renderer.width, this.app.renderer.height, shake.x, shake.y);
    this.renderer.draw(this.town, this.dozer, this.particles, this.birds, this.dozer.x, this.dozer.y);
    this.hud.render({
      cash: this.cash,
      score: this.score,
      timeLeft: this.timeLeft,
      bladeDown: this.dozer.bladeDown,
      muted: this.audio.muted,
      heat: this.dozer.heat,
      track: this.dozer.track,
      hintAlpha: this.mode === "play" ? Math.min(1, this.hint + 0.15) : 1,
      overlay: this.mode === "play" ? "none" : this.mode,
      death: this.death,
      won: this.mode === "results" && this.cash >= CASH_TARGET && !this.death,
    });
  }

  destroy(): void {
    this.detachInput?.();
    this.app.destroy();
  }
}

export async function boot(): Promise<Game> {
  const root = document.querySelector<HTMLElement>("#game-root");
  const hud = document.querySelector<HTMLElement>("#hud-root");
  if (!root || !hud) throw new Error("Missing #game-root or #hud-root");
  const game = new Game();
  await game.start(root, hud);
  return game;
}
