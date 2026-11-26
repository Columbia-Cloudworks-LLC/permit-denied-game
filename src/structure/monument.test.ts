import { expect, it } from 'vitest';
import { defaultDebugView } from '../debug/view';
import { ParticlePool } from '../fx/particles';
import { FLOOR_Z } from '../game/constants';
import { monumentCommands } from '../render/monument';
import { applyMonumentImpact, applyMonumentRoll } from '../sim/monumentImpact';
import { createDozer } from '../vehicle/dozer';
import { archetypeById, validateBuildingDefinition } from '../world/archetypes';
import { resetPropIds, spawnAsset } from '../world/catalog';
import '../world/landmarkPack';
import { createTown } from '../world/town';
import { applyCellDamage, createBuildingFromArchetype, stepStructures, type StructureStepResult } from './building';
import { MONUMENT_FIGURES, monumentBallRadius, monumentFall, monumentPose, monumentReach, monumentSeat, monumentSweep, SPAN_DROP, SPAN_LANDING, spanDuration, spanFall, spanPoint, type MonumentImpact } from './monument';
import { southWindowed } from './facadeTrim';
import type { Building, WorldEvent } from './types';

const statue = (): Building => createBuildingFromArchetype('liberty-statue', 'STATUE', 10, 10);

/** Knock out one of the plinth's top-floor wall cells, as losing the walls under it would. */
function breach(b: Building, gx: number, gy: number, particles: ParticlePool): void {
  applyCellDamage(b, b.grid[b.floors - 1]![gx]![gy]!, 100000, 1, 0, particles, []);
}

function run(b: Building, particles: ParticlePool, steps: number, events: WorldEvent[] = []): StructureStepResult[] {
  const results: StructureStepResult[] = [];
  for (let i = 0; i < steps; i++) results.push(stepStructures([b], 1 / 60, particles, events));
  return results;
}

it('stands a drawn statue on a three-storey stone plinth of ordinary cells', () => {
  const b = statue(), particles = new ParticlePool();
  expect(b.floors).toBe(3);
  expect(b.coreCollapse).toBeUndefined();
  // Wall rings of 7 x 7, 5 x 5 and 3 x 3.
  expect(b.monument!.columns).toHaveLength(24 + 16 + 8);
  run(b, particles, 300);
  expect(b.monument!.phase).toBe('standing');
  expect(b.monument!.support).toBe(1);
  const pose = monumentPose(b);
  expect(pose.z).toBeCloseTo(3 * FLOOR_Z);
  expect(pose.theta).toBe(0);
  expect(monumentCommands(b, defaultDebugView())).toHaveLength(1);
});

it('keeps standing with under half its support gone, then leans toward the side that was eaten away', () => {
  const b = statue(), particles = new ParticlePool();
  // The plinth's top course is grid 2..4: take the whole east file and one more, exactly half.
  for (const gy of [2, 3, 4]) breach(b, 4, gy, particles);
  breach(b, 3, 2, particles);
  run(b, particles, 240);
  expect(b.monument!.phase).toBe('standing');
  expect(b.monument!.support).toBeCloseTo(0.5);
  breach(b, 3, 4, particles);
  run(b, particles, 30);
  expect(b.monument!.phase).toBe('warning');
  // The lost cells sit east of centre: the fall goes that way.
  expect(b.monument!.dx).toBeGreaterThan(0.9);
  expect(Math.hypot(b.monument!.dx, b.monument!.dy)).toBeCloseTo(1);
});

it('comes down when the dozer eats half of the star fort wall at ground level', () => {
  const b = statue(), particles = new ParticlePool();
  const fort = b.cells.filter(cell => cell.floor === 0);
  expect(fort).toHaveLength(24);
  // The west side of the fort, a cell short of half: still standing.
  const west = fort.filter(cell => cell.gx <= 3);
  for (const cell of west.slice(0, 12)) applyCellDamage(b, cell, 100000, 1, 0, particles, []);
  run(b, particles, 60);
  expect(b.monument!.phase).toBe('standing');
  expect(b.monument!.support).toBeCloseTo(0.5);
  applyCellDamage(b, west[12]!, 100000, 1, 0, particles, []);
  run(b, particles, 900);
  expect(b.monument!.phase).toBe('gone');
  expect(b.monument!.dx).toBeLessThan(-0.7);
});

it('topples, lands along its length, shatters into tinted copper and pays once', () => {
  const b = statue(), particles = new ParticlePool(), events: WorldEvent[] = [];
  for (const [gx, gy] of [[2, 2], [2, 3], [2, 4], [3, 2], [3, 4]] as const) breach(b, gx, gy, particles);
  const standing = monumentPose(b);
  let lowest = Infinity, widest = 0;
  const results: StructureStepResult[] = [];
  for (let i = 0; i < 600; i++) {
    results.push(...run(b, particles, 1, events));
    if (b.monument!.phase !== 'falling') continue;
    const pose = monumentPose(b);
    lowest = Math.min(lowest, pose.z);
    widest = Math.max(widest, pose.theta);
  }
  expect(b.monument!.phase).toBe('gone');
  expect(lowest).toBeLessThan(standing.z * 0.2);
  expect(widest).toBeGreaterThan(1.2);
  const impacts = results.flatMap(result => result.monumentImpacts);
  expect(impacts).toHaveLength(1);
  const impact = impacts[0]!, def = b.monument!.definition;
  expect(Math.hypot(impact.x1 - impact.x0, impact.y1 - impact.y0)).toBeCloseTo(def.height);
  // It fell west, toward the breached file.
  expect(impact.x1).toBeLessThan(impact.x0);
  const pieces = results.flatMap(result => result.rubbleSpawns).filter(spawn => spawn.tint === def.color);
  expect(pieces.length).toBeGreaterThanOrEqual(8);
  expect(pieces.every(piece => piece.material === 'metal')).toBe(true);
  expect(results.reduce((sum, result) => sum + result.cash, 0)).toBeGreaterThanOrEqual(def.bonus);
  expect(events.filter(event => event.kind === 'cash' && event.cash === def.bonus)).toHaveLength(1);
  expect(monumentCommands(b, defaultDebugView())).toEqual([]);
});

it('hurts a dozer under the falling statue and spares one standing clear', () => {
  const b = statue();
  const impact: MonumentImpact = { building: b, x0: 0, y0: 0, x1: 11, y1: 0, radius: 2.5 };
  const under = createDozer(5, 0.5, 0), clear = createDozer(5, 9, 0), events: WorldEvent[] = [];
  expect(applyMonumentImpact(under, impact, events)).toBe(true);
  expect(under.heat).toBeGreaterThan(15);
  expect(under.track).toBeGreaterThan(18);
  expect(Math.abs(under.vy)).toBeGreaterThan(1);
  expect(applyMonumentImpact(clear, impact, events)).toBe(false);
  expect(clear.heat).toBe(0);
  expect(clear.track).toBe(0);
});

it('rejects a statue on a plinth too tall to simulate cell by cell', () => {
  const a = structuredClone(archetypeById('liberty-statue'));
  a.monument!.minimumSupport = 1.5;
  expect(validateBuildingDefinition(a).join(' ')).toContain('Invalid monument configuration');
});

const FIGURE_PACKAGES = ['liberty-statue', 'paris-lattice-tower', 'linq-observation-wheel', 'vegas-welcome-sign', 'desert-orb-arena', 'luxor-sphinx', 'lakefront-wing-museum', 'fan-roof-ballpark', 'kerrey-cable-footbridge', 'saucer-needle-tower', 'science-center-arches'] as const;

/** Knock out ground-floor wall cells from one side of the plinth, one more than half of them. */
function undermine(b: Building, side: (cell: Building['cells'][number]) => number, particles: ParticlePool): void {
  const ground = b.cells.filter(cell => cell.floor === 0).sort((a, c) => side(a) - side(c));
  for (const cell of ground.slice(0, Math.floor(ground.length / 2) + 1)) applyCellDamage(b, cell, 100000, 1, 0, particles, []);
}

it.each(FIGURE_PACKAGES)('draws the %s figure as one command on a plinth of three floors or fewer', id => {
  const b = createBuildingFromArchetype(id, 'FIGURE', 10, 10);
  expect(b.floors).toBeLessThanOrEqual(3);
  expect(validateBuildingDefinition(archetypeById(id))).toEqual([]);
  expect(monumentCommands(b, defaultDebugView())).toHaveLength(1);
});

it('has a package for every figure the renderer and the validator know', () => {
  const used = new Set(FIGURE_PACKAGES.map(id => archetypeById(id).monument!.figure));
  expect([...used].sort()).toEqual([...MONUMENT_FIGURES].sort());
});

it('drops a bridge span pier by pier into the river once its mast is down', () => {
  const b = createBuildingFromArchetype('kerrey-cable-footbridge', 'BRIDGE', 20, 20), particles = new ParticlePool(), events: WorldEvent[] = [];
  const s = b.monument!, def = s.definition, span = def.span!, seat = monumentSeat(b);
  expect(span.piers).toEqual([...span.piers].sort((a, c) => a - c));
  expect(span.mast).toBeGreaterThanOrEqual(0);
  // The deck is seen as far as it reaches, well past the mast's own height.
  expect(monumentSweep(def)).toBeGreaterThan(span.reach);
  expect(span.reach).toBeGreaterThan(def.height);
  // Standing: nothing has dropped, and the whole bridge is one command.
  expect(spanFall(s)).toEqual({ landing: 0, piers: span.piers.map(() => 0), decks: [0, ...span.piers.map(() => 0)] });
  expect(monumentCommands(b, defaultDebugView())).toHaveLength(1);

  undermine(b, cell => -cell.gx, particles);
  const results: StructureStepResult[] = [];
  // While the mast leans and topples the deck holds.
  for (let i = 0; i < 900 && s.phase !== 'chain'; i++) {
    results.push(...run(b, particles, 1, events));
    expect(spanFall(s)!.decks.every(share => share === 0)).toBe(true);
  }
  expect(s.phase).toBe('chain');
  // The mast pays as it lands; the landing strikes the bank beside it.
  expect(events.filter(event => event.kind === 'cash' && event.cash === def.bonus)).toHaveLength(1);
  const landed = results.flatMap(result => result.monumentImpacts);
  expect(landed).toHaveLength(2);
  const west = spanPoint(def, -SPAN_LANDING);
  expect(landed[0]).toMatchObject({ x0: seat.x + west.x, x1: seat.x });
  expect(b.fullyDown).toBeFalsy();

  // Then the piers go in order, bank side first, each after the one before.
  const order: number[] = [], firstSeen = new Map<number, number>();
  const jolts = events.filter(event => event.kind === 'collapse').length;
  let steps = 0;
  for (; steps < 900 && (s.phase as string) === 'chain'; steps++) {
    const before = spanFall(s)!;
    run(b, particles, 1, events);
    const after = spanFall(s)!;
    after.piers.forEach((share, k) => {
      expect(share).toBeGreaterThanOrEqual(before.piers[k]!);
      if (share > 0 && !firstSeen.has(k)) { firstSeen.set(k, steps); order.push(k); }
      // A pier never starts before the one nearer the bank, and the deck beyond it goes with it.
      if (k > 0) expect(share).toBeLessThanOrEqual(after.piers[k - 1]!);
      expect(after.decks[k + 1]).toBe(share);
    });
    // The stretch the mast held went first, with the landing.
    expect(after.decks[0]).toBeGreaterThanOrEqual(after.decks[1]!);
    expect(after.landing).toBe(after.decks[0]);
    if (s.phase === 'chain') expect(monumentCommands(b, defaultDebugView())).toHaveLength(1);
  }
  expect(order).toEqual(span.piers.map((_, k) => k));
  for (let k = 1; k < span.piers.length; k++) expect((firstSeen.get(k)! - firstSeen.get(k - 1)!) / 60).toBeCloseTo(span.interval, 1);
  expect(steps / 60).toBeCloseTo(spanDuration(span), 1);
  expect(spanDuration(span)).toBe(span.piers.length * span.interval + SPAN_DROP);
  // One jolt per pier, each out over the water east of the bank.
  const splashes = events.filter(event => event.kind === 'collapse').slice(jolts);
  expect(splashes).toHaveLength(span.piers.length);
  splashes.forEach((event, k) => {
    expect(event.x).toBeCloseTo(seat.x + span.piers[k]! * span.reach, 6);
    if (k) expect(event.x).toBeGreaterThan(splashes[k - 1]!.x);
  });
  expect(s.phase).toBe('gone');
  expect(spanFall(s)!.decks.every(share => share === 1)).toBe(true);
  expect(monumentCommands(b, defaultDebugView())).toEqual([]);
  // Nothing more is paid for the span.
  expect(events.filter(event => event.kind === 'cash' && event.cash === def.bonus)).toHaveLength(1);
});

it('rejects a span on a figure that cannot carry one, or with piers out of order', () => {
  const bridge = archetypeById('kerrey-cable-footbridge'), span = bridge.monument!.span!;
  const withSpan = (change: object) => validateBuildingDefinition({ ...bridge, monument: { ...bridge.monument!, span: { ...span, ...change } } });
  expect(withSpan({})).toEqual([]);
  expect(withSpan({ piers: [0.5, 0.3] })).toContain('Invalid monument span');
  expect(withSpan({ piers: [0.5, 1] })).toContain('Invalid monument span');
  expect(withSpan({ mast: 9 })).toContain('Invalid monument span');
  expect(withSpan({ interval: 0 })).toContain('Invalid monument span');
  const statue = archetypeById('liberty-statue');
  expect(validateBuildingDefinition({ ...statue, monument: { ...statue.monument!, span } })).toContain('Invalid monument span');
});

it('crumbles a sphinx where it stands and strikes a circle round its plinth', () => {
  const b = createBuildingFromArchetype('luxor-sphinx', 'SPHINX', 20, 20), particles = new ParticlePool(), events: WorldEvent[] = [];
  const def = b.monument!.definition, standing = monumentPose(b);
  expect(monumentFall(def)).toBe('crumble');
  undermine(b, cell => cell.gx, particles);
  let flattest = 0, strayed = 0;
  const results: StructureStepResult[] = [];
  for (let i = 0; i < 600 && b.monument!.phase !== 'gone'; i++) {
    results.push(...run(b, particles, 1, events));
    const pose = monumentPose(b);
    flattest = Math.max(flattest, pose.squash);
    strayed = Math.max(strayed, Math.hypot(pose.x - standing.x, pose.y - standing.y));
    // It never leans over like a pole.
    expect(Math.abs(pose.theta)).toBeLessThan(0.05);
  }
  expect(b.monument!.phase).toBe('gone');
  expect(flattest).toBeGreaterThan(0.9);
  expect(strayed).toBeLessThan(0.3);
  const impacts = results.flatMap(result => result.monumentImpacts);
  expect(impacts).toHaveLength(1);
  const impact = impacts[0]!;
  expect(impact.rolling).toBeUndefined();
  expect(Math.hypot(impact.x1 - impact.x0, impact.y1 - impact.y0)).toBe(0);
  expect(impact.radius).toBeGreaterThan(def.height * 0.4);
  expect(results.flatMap(result => result.rubbleSpawns).filter(spawn => spawn.tint === def.color).length).toBeGreaterThanOrEqual(8);
  expect(events.filter(event => event.kind === 'cash' && event.cash === def.bonus)).toHaveLength(1);
  expect(monumentCommands(b, defaultDebugView())).toEqual([]);
});

it('rolls the sphere off its drum toward the breached wall, its whole reach, then bursts', () => {
  const b = createBuildingFromArchetype('desert-orb-arena', 'SPHERE', 40, 40), particles = new ParticlePool(), events: WorldEvent[] = [];
  const def = b.monument!.definition, standing = monumentPose(b);
  expect(monumentFall(def)).toBe('roll');
  // Eat the west half of the drum: it rolls west.
  undermine(b, cell => cell.gx, particles);
  const results: StructureStepResult[] = [];
  let lastSpin = 0, lastTravel = 0;
  for (let i = 0; i < 900 && b.monument!.phase !== 'gone'; i++) {
    results.push(...run(b, particles, 1, events));
    if (b.monument!.phase !== 'falling') continue;
    const pose = monumentPose(b), travel = standing.x - pose.x;
    // Always forward, always turning the way it travels, never back up onto the drum.
    expect(travel).toBeGreaterThanOrEqual(lastTravel - 1e-9);
    expect(pose.spin).toBeGreaterThanOrEqual(lastSpin - 1e-9);
    lastTravel = travel;
    lastSpin = pose.spin;
  }
  expect(b.monument!.phase).toBe('gone');
  expect(b.monument!.dx).toBeLessThan(-0.9);
  expect(lastTravel).toBeGreaterThan(monumentReach(def) * 0.95);
  const impacts = results.flatMap(result => result.monumentImpacts);
  const sweeps = impacts.filter(impact => impact.rolling);
  expect(sweeps.length).toBeGreaterThan(60);
  // It sweeps only once it is down off the drum, each stretch from where the last one ended.
  expect(sweeps.every(sweep => sweep.radius === monumentBallRadius(def))).toBe(true);
  for (let i = 1; i < sweeps.length; i++) expect(sweeps[i]!.x0).toBeCloseTo(sweeps[i - 1]!.x1, 6);
  expect(sweeps[0]!.x1).toBeLessThan(b.x);
  const burst = impacts.filter(impact => !impact.rolling);
  expect(burst).toHaveLength(1);
  expect(burst[0]!.x1).toBeLessThan(standing.x - monumentReach(def));
  expect(results.reduce((sum, result) => sum + result.cash, 0)).toBeGreaterThanOrEqual(def.bonus);
  expect(events.filter(event => event.kind === 'cash' && event.cash === def.bonus)).toHaveLength(1);
});

it('flattens props and breaks walls under a rolling figure, and runs the dozer down only once', () => {
  resetPropIds();
  const town = createTown(), particles = new ParticlePool(), events: WorldEvent[] = [];
  const source = createBuildingFromArchetype('desert-orb-arena', 'SPHERE', 200, 200);
  const other = createBuildingFromArchetype('liberty-statue', 'IN THE WAY', 60, 60);
  const tree = spawnAsset('oak', 59, 58), far = spawnAsset('oak', 90, 90);
  town.buildings.push(source, other);
  town.props.push(tree, far);
  const radius = monumentBallRadius(source.monument!.definition);
  const impact: MonumentImpact = { building: source, x0: 59, y0: 62, x1: 60, y1: 62, radius, rolling: true };
  const dozer = createDozer(61, 63, 0);
  const broken = () => other.cells.filter(cell => cell.floor === 0 && cell.state !== 'intact').length;
  expect(broken()).toBe(0);
  applyMonumentRoll(town, dozer, impact, particles, events);
  expect(tree.broken).toBe(true);
  expect(far.broken).toBe(false);
  expect(broken()).toBeGreaterThan(0);
  // Walls beyond its reach are untouched, and so is the drum it came from.
  expect(other.cells.filter(cell => cell.floor === 0 && cell.gx === 6).every(cell => cell.state === 'intact')).toBe(true);
  expect(source.cells.every(cell => cell.state === 'intact')).toBe(true);
  const heat = dozer.heat;
  expect(heat).toBeGreaterThan(8);
  applyMonumentRoll(town, dozer, impact, particles, events);
  expect(dozer.heat).toBe(heat);
});

it('shoves the dozer straight out from a figure that came down on one spot', () => {
  const b = statue();
  const impact: MonumentImpact = { building: b, x0: 10, y0: 10, x1: 10, y1: 10, radius: 4 };
  const dozer = createDozer(12, 10, 0);
  expect(applyMonumentImpact(dozer, impact, [])).toBe(true);
  expect(dozer.vx).toBeGreaterThan(1);
  expect(Math.abs(dozer.vy)).toBeLessThan(1e-6);
});

it('rejects a fall the sim does not know, and a reach on a figure that does not roll', () => {
  const unknown = structuredClone(archetypeById('luxor-sphinx'));
  (unknown.monument as { fall: string }).fall = 'explode';
  expect(validateBuildingDefinition(unknown).join(' ')).toContain('Invalid monument configuration');
  const reach = structuredClone(archetypeById('luxor-sphinx'));
  reach.monument!.reach = 20;
  expect(validateBuildingDefinition(reach).join(' ')).toContain('Invalid monument configuration');
});

it.each(['luxor-sphinx', 'vegas-welcome-sign'])('stands the %s on a blind plinth: a door, and no window authored or implied', id => {
  const b = createBuildingFromArchetype(id, 'PLINTH', 10, 10);
  expect(b.windowStride).toBe(0);
  expect(b.cells.some(cell => cell.doorS)).toBe(true);
  expect(b.cells.filter(cell => cell.windowN || cell.windowE || cell.windowS || cell.windowW)).toEqual([]);
  expect(b.cells.filter(cell => southWindowed(b, cell))).toEqual([]);
  // A glazed plinth still is: the statue's fort keeps its windows.
  const fort = statue();
  expect(fort.cells.some(cell => southWindowed(fort, cell))).toBe(true);
  const negative = structuredClone(archetypeById(id));
  negative.windowStride = -1;
  expect(validateBuildingDefinition(negative).join(' ')).toContain('Invalid window stride');
});
