/** Stop immediately when a step opens a modal. Paused time never leaks into resume. */
export function advanceSimulation(acc: number, dt: number, limit: number, playing: () => boolean, step: () => void) {
  let steps = 0;
  while (playing() && acc >= dt && steps < limit) {
    step();
    acc -= dt;
    steps++;
  }
  const dropped = playing() && steps === limit ? acc : 0;
  return { acc: !playing() || steps === limit ? 0 : acc, dropped };
}
