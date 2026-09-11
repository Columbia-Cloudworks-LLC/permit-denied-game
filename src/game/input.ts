export class Input {
  readonly down = new Set<string>();
  readonly pressed = new Set<string>();
  muteChord = false;
  private touch = { throttle: 0, steer: 0, blade: false };

  setTouch(state: { throttle: number; steer: number; blade: boolean }): void {
    this.touch = { ...state };
  }

  reset(): void {
    this.down.clear();
    this.pressed.clear();
    this.touch = { throttle: 0, steer: 0, blade: false };
  }

  attach(target: Window = window): () => void {
    const onDown = (e: KeyboardEvent) => {
      if (e.target instanceof Element && (e.target.closest("#debug-panel, .yard-panel, input, select, textarea") ||
        (e.target.closest(".debug-menu") && [" ", "Enter"].includes(e.key)))) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
      }
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.down.delete(k);
    };
    const onBlur = () => {
      this.reset();
    };
    target.addEventListener("keydown", onDown);
    target.addEventListener("keyup", onUp);
    target.addEventListener("blur", onBlur);
    return () => {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
    };
  }

  consume(key: string): boolean {
    if (this.pressed.has(key)) {
      this.pressed.delete(key);
      return true;
    }
    return false;
  }

  flush(): void {
    this.pressed.clear();
  }

  axis(): { throttle: number; steer: number } {
    let throttle = 0;
    let steer = 0;
    if (this.down.has("w") || this.down.has("ArrowUp")) throttle += 1;
    if (this.down.has("s") || this.down.has("ArrowDown")) throttle -= 1;
    if (this.down.has("a") || this.down.has("ArrowLeft")) steer -= 1;
    if (this.down.has("d") || this.down.has("ArrowRight")) steer += 1;
    const hasThrottle = ["w", "s", "ArrowUp", "ArrowDown"].some(k => this.down.has(k));
    const hasSteer = ["a", "d", "ArrowLeft", "ArrowRight"].some(k => this.down.has(k));
    return { throttle: hasThrottle ? throttle : this.touch.throttle, steer: hasSteer ? steer : this.touch.steer };
  }

  blade(): boolean {
    return this.down.has(" ") || this.touch.blade;
  }
}

/** Independent axis dead zones let the driver steer in place without creeping. */
export function stickAxes(x: number, y: number): { throttle: number; steer: number } {
  const axis = (value: number) => Math.abs(value) <= 0.15 ? 0 : Math.sign(value) * Math.min(1, (Math.abs(value) - 0.15) / 0.85);
  return { throttle: axis(-y), steer: axis(x) };
}
