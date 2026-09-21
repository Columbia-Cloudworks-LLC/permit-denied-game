import type { Application } from "pixi.js";

/** Pixi ticker registration for the simulation/render frame. */
export function startRuntimeTicker(app: Application, frame: (dt: number) => void): void {
  app.ticker.add((ticker) => {
    frame(Math.min(0.05, ticker.deltaMS / 1000));
  });
}
