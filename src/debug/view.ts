/** Render switches never alter building health, support, collision, or simulation state. */
export const DEBUG_GROUPS = [
  { label: "Visible layers", options: [
    ["roofs", "Roofs & chimneys", true], ["walls", "Walls & partitions", true],
    ["floors", "Floors", true], ["contents", "Interior contents", true],
    ["props", "Outdoor props", true], ["debris", "Rubble & piles", true],
    ["effects", "Dust, particles & marks", true], ["terrain", "Terrain & lot surfaces", true],
    ["roads", "Road pavement", true], ["sites", "Foundation scars", true],
  ] },
  { label: "Overlays", options: [
    ["paths", "Road paths & vehicle route", false], ["lots", "Lot boundaries", false],
    ["buildable", "Buildable boundaries", false], ["rooms", "Room boundaries", false],
    ["collision", "Active collision shapes", false], ["supports", "Structural supports", false],
  ] },
  { label: "Inspection", options: [
    ["reveal", "Reveal intact interiors", false], ["overview", "District overview (G)", false],
    ["perf", "Performance stats (`)", false], ["freeze", "Freeze simulation", false],
  ] },
] as const;

export type DebugToggle = typeof DEBUG_GROUPS[number]["options"][number][0];
export type DebugView = Record<DebugToggle, boolean> & { maxFloor: number };

export function defaultDebugView(): DebugView {
  const state = { maxFloor: 99 } as DebugView;
  for (const group of DEBUG_GROUPS) for (const [key, , value] of group.options) state[key] = value;
  return state;
}
