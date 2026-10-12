import { describe, expect, it } from "vitest";
import { defaultDebugView } from "../debug/view";
import { createBuildingFromArchetype } from "../structure/building";
import {
  buildingAnimating,
  buildingDamaged,
  buildingIsLive,
  buildingLod,
  buildingNeedsDetails,
  buildingNeedsInterior,
  CHUNK_SEGMENT,
  ChunkSplitMemory,
  coalesceStaticChunks,
  debugViewSignature,
  SPLIT_HOLD_FRAMES,
  type ChunkCommand,
} from "./buildingLod";

describe("building render lod", () => {
  const view = defaultDebugView();

  it("keeps interiors for near, glass, reveal, and damaged shells", () => {
    const ranch = createBuildingFromArchetype("ranch", "RANCH", 0, 0);
    const needle = createBuildingFromArchetype("needle-office", "NEEDLE", 0, 0);
    expect(buildingNeedsInterior(ranch, view, "street")).toBe(false);
    expect(buildingNeedsInterior(ranch, view, "overview")).toBe(false);
    expect(buildingNeedsInterior(ranch, view, "near")).toBe(true);
    expect(buildingNeedsInterior(ranch, { ...view, reveal: true }, "street")).toBe(true);
    ranch.roofs[0]!.state = "gone";
    expect(buildingDamaged(ranch)).toBe(true);
    expect(buildingNeedsInterior(ranch, view, "street")).toBe(true);
    if (needle.construction.skin === "glass") {
      expect(buildingNeedsInterior(needle, view, "overview")).toBe(true);
    }
  });

  it("hides facade details in overview and keeps them on the street", () => {
    expect(buildingNeedsDetails(view, "overview")).toBe(false);
    expect(buildingNeedsDetails(view, "street")).toBe(true);
    expect(buildingNeedsDetails(view, "near")).toBe(true);
    expect(buildingNeedsDetails({ ...view, details: false }, "street")).toBe(false);
  });

  it("treats only near or moving buildings as live", () => {
    expect(buildingLod(true, false, 1.15)).toBe("near");
    expect(buildingLod(false, true, 0.2)).toBe("overview");
    expect(buildingLod(false, false, 1.15)).toBe("street");
    expect(buildingIsLive("near", false)).toBe(true);
    expect(buildingIsLive("street", false)).toBe(false);
    expect(buildingIsLive("overview", true)).toBe(true);
    expect(debugViewSignature(view)).toBe(debugViewSignature(defaultDebugView()));
  });

  it("counts a still wreck as cacheable and falling or sagging pieces as moving", () => {
    const ranch = createBuildingFromArchetype("ranch", "RANCH", 0, 0);
    expect(buildingAnimating(ranch)).toBe(false);
    ranch.cells[0]!.state = "gone";
    expect(buildingDamaged(ranch)).toBe(true);
    expect(buildingAnimating(ranch)).toBe(false);
    ranch.cells[1]!.state = "falling";
    expect(buildingAnimating(ranch)).toBe(true);
    ranch.cells[1]!.state = "gone";
    const roof = ranch.roofs[0]!;
    roof.state = "sagging";
    expect(buildingAnimating(ranch)).toBe(true);
    roof.state = "intact"; roof.sag = 0.3;
    expect(buildingAnimating(ranch)).toBe(true);
    roof.state = "gone"; roof.sag = 1;
    expect(buildingAnimating(ranch)).toBe(false);
  });

  it("coalesces consecutive static chunks without reordering other commands", () => {
    const order: string[] = [];
    const paint = (id: string) => ({
      chunk: id.startsWith("b") ? id : undefined,
      version: 1,
      depth: order.length,
      run: (_g: unknown) => { void _g; order.push(id); },
    });
    const cmds = [paint("b1"), paint("b1"), paint("p"), paint("b2"), paint("b2"), paint("b2")];
    const merged = coalesceStaticChunks(cmds);
    expect(merged).toHaveLength(3);
    for (const cmd of merged) cmd.run({} as never);
    expect(order).toEqual(["b1", "b1", "p", "b2", "b2", "b2"]);
  });

  const piece = (chunk: string | undefined, key: string, extra: Partial<ChunkCommand> = {}): ChunkCommand => ({
    chunk, key, version: chunk?.startsWith("b") ? 1 : undefined, depth: 0, run: () => {}, ...extra,
  });
  const wall = (n: number) => Array.from({ length: n }, (_, i) => piece("b1", `w${i}`));
  const keys = (cmds: ChunkCommand[]) => coalesceStaticChunks(cmds).map((cmd) => cmd.key);

  it("breaks runs at stationary neighbours but finds the same runs whatever moves past", () => {
    const [a, b, c, d] = wall(4);
    const tree = piece(undefined, "tree", { version: 1 });
    expect(keys([a!, b!, tree, c!, d!])).toEqual(["chunk:b1:w0:w1:2", "tree", "chunk:b1:w2:w3:2"]);
    const car = piece(undefined, "car", { version: 2, mobile: true });
    expect(keys([car, a!, b!, c!, d!])).toEqual(["car", "chunk:b1:w0:w3:4"]);
    // A mover inside the run falls back to member keys, which stay put as it moves along.
    expect(keys([a!, car, b!, c!, d!])).toEqual(["w0", "car", "w1", "w2", "w3"]);
    expect(keys([a!, b!, c!, car, d!])).toEqual(["w0", "w1", "w2", "car", "w3"]);
  });

  it("caps merged runs at a fixed segment so one split repaints a bounded run", () => {
    const merged = coalesceStaticChunks(wall(CHUNK_SEGMENT + 6));
    expect(merged.map((cmd) => cmd.key)).toEqual([`chunk:b1:w0:w${CHUNK_SEGMENT - 1}:${CHUNK_SEGMENT}`, `chunk:b1:w${CHUNK_SEGMENT}:w${CHUNK_SEGMENT + 5}:6`]);
  });

  it("holds a crossed run split while traffic keeps passing, then merges it again", () => {
    const run = wall(3);
    const car = piece(undefined, "car", { version: 1, mobile: true });
    const memory = new ChunkSplitMemory();
    const frame = (cmds: ChunkCommand[]) => { memory.next(); return coalesceStaticChunks(cmds, memory).map((cmd) => cmd.key); };
    expect(frame(run)).toEqual(["chunk:b1:w0:w2:3"]);
    expect(frame([run[0]!, car, run[1]!, run[2]!])).toEqual(["w0", "car", "w1", "w2"]);
    expect(frame([...run, car])).toEqual(["w0", "w1", "w2", "car"]);
    for (let i = 0; i < SPLIT_HOLD_FRAMES; i++) frame(run);
    expect(frame(run)).toEqual(["chunk:b1:w0:w2:3"]);
    // Stale crossings are pruned on the next hold boundary.
    for (let i = 0; i < SPLIT_HOLD_FRAMES; i++) frame(run);
    expect(memory.lastSplit.size).toBe(0);
  });

  it("keys unversioned effect runs by ordinal so their Graphics survive the run moving", () => {
    const fx = (key: string) => piece("fx", key, { mobile: true });
    const tree = piece(undefined, "tree", { version: 1 });
    const merged = coalesceStaticChunks([fx("a"), fx("b"), tree, fx("c")]);
    expect(merged.map((cmd) => cmd.key)).toEqual(["fx:0", "tree", "fx:1"]);
    const order: string[] = [];
    const painted = coalesceStaticChunks<ChunkCommand>([
      { ...fx("a"), run: () => { order.push("a"); } }, { ...fx("b"), run: () => { order.push("b"); } },
    ]);
    painted[0]!.run({} as never);
    expect(order).toEqual(["a", "b"]);
  });
});
