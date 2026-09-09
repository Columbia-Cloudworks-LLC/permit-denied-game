export class Input {
  readonly down = new Set<string>();
  readonly pressed = new Set<string>();
  muteChord = false;

  attach(target: Window = window): () => void {
    const onDown = (e: KeyboardEvent) => {
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
    const onBlur = () => this.down.clear();
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
    return { throttle, steer };
  }

  blade(): boolean {
    return this.down.has(" ");
  }
}
