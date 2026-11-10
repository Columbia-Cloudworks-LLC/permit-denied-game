/**
 * Run the fixed steps this frame owes. Stops immediately when a step opens a modal; paused
 * time never leaks into resume.
 *
 * Two caps keep a slow step from feeding on itself: at most `limit` steps, and no new step
 * once this frame has spent `budgetMs` simulating. Either way the time still owed is dropped,
 * so a collapse spike plays out a little slow instead of stretching every following frame.
 */
export function advanceSimulation(
  acc: number,
  dt: number,
  limit: number,
  playing: () => boolean,
  step: () => void,
  budgetMs = Infinity,
  now: () => number = () => performance.now(),
) {
  let steps = 0;
  let spent = false;
  const start = budgetMs < Infinity ? now() : 0;
  while (playing() && acc >= dt && steps < limit && !spent) {
    step();
    acc -= dt;
    steps++;
    spent = budgetMs < Infinity && now() - start >= budgetMs;
  }
  const capped = steps === limit || (spent && acc >= dt);
  const dropped = playing() && capped ? acc : 0;
  return { acc: !playing() || capped ? 0 : acc, dropped };
}
