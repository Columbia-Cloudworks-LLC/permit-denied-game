import type { Graphics } from "pixi.js";
import { rooftopPoint, rooftopPose, ROOFTOP_KINDS, type RooftopPose } from "../structure/rooftop";
import type { Building, RooftopFixture, RooftopKind } from "../structure/types";
import { drawWorldPoly } from "./drawIso";
import { PAL, shade } from "./palette";
import { wallTone } from "./wallPaint";

interface Tone { top: number; left: number; right: number }

const GALV: Tone = { top: PAL.galv, left: PAL.galvDark, right: PAL.galvMid };
const SPUN: Tone = { top: 0xdde2e1, left: 0x8d9795, right: 0xb6bebc };
const DARK: Tone = { top: 0x5a6260, left: 0x2f3534, right: 0x444b4a };
const CURB: Tone = { top: 0x8a8d86, left: 0x4f524d, right: 0x6c6f69 };
const TOWER: Tone = { top: 0xbab6a4, left: 0x77745f, right: 0x99957f };
const COOLER: Tone = { top: 0xdad6c6, left: 0x8f8b7a, right: 0xb5b1a0 };

/** Small fittings an overview zoom cannot resolve; plant, hoods, ducts, masts and arrays keep their silhouette. */
const FINE_KINDS: ReadonlySet<RooftopKind> = new Set(["vent-stack", "gooseneck-vent", "turbine-vent", "flue-stack", "roof-hatch", "split-condenser", "skylight-curb"]);

/** Whether a fixture is drawn at this level of detail. */
export function rooftopVisibleAt(kind: RooftopKind, detail: boolean): boolean {
  return detail || !FINE_KINDS.has(kind);
}

/**
 * Draws in the fixture's footprint: `u` and `v` run 0..1 across its box, heights are world units
 * above the deck. Every point goes through the pose, so the unit rides a sagging roof panel.
 */
class GearPen {
  constructor(
    private readonly g: Graphics,
    private readonly pose: RooftopPose,
    private readonly alpha: number,
    readonly detail: boolean,
    private readonly snow: boolean,
  ) {}

  private pt(u: number, v: number, z: number) {
    const { box } = this.pose;
    return rooftopPoint(this.pose, box.x + box.w * u, box.y + box.d * v, z);
  }

  /** A box with its three camera-facing faces. */
  box(u: number, v: number, du: number, dv: number, z0: number, h: number, tone: Tone): void {
    const z1 = z0 + h, u1 = u + du, v1 = v + dv;
    drawWorldPoly(this.g, [this.pt(u1, v, z1), this.pt(u1, v1, z1), this.pt(u1, v1, z0), this.pt(u1, v, z0)], tone.right, this.alpha);
    drawWorldPoly(this.g, [this.pt(u, v1, z1), this.pt(u1, v1, z1), this.pt(u1, v1, z0), this.pt(u, v1, z0)], tone.left, this.alpha);
    this.top(u, v, du, dv, z1, this.snow && du * dv > 0.08 ? PAL.roofSnow : tone.top);
  }

  top(u: number, v: number, du: number, dv: number, z: number, color: number, alpha = 1): void {
    drawWorldPoly(this.g, [this.pt(u, v, z), this.pt(u + du, v, z), this.pt(u + du, v + dv, z), this.pt(u, v + dv, z)], color, this.alpha * alpha);
  }

  /** A panel on the south face, between two heights. */
  south(u: number, du: number, z0: number, z1: number, color: number, v = 1): void {
    drawWorldPoly(this.g, [this.pt(u, v, z1), this.pt(u + du, v, z1), this.pt(u + du, v, z0), this.pt(u, v, z0)], color, this.alpha);
  }

  /** A panel on the east face. */
  east(v: number, dv: number, z0: number, z1: number, color: number, u = 1): void {
    drawWorldPoly(this.g, [this.pt(u, v, z1), this.pt(u, v + dv, z1), this.pt(u, v + dv, z0), this.pt(u, v, z0)], color, this.alpha);
  }

  /** An eight-sided disc lying flat: fan rings, hood caps, turbine heads. */
  disc(cu: number, cv: number, ru: number, rv: number, z: number, color: number): void {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) * Math.PI / 4;
      pts.push(this.pt(cu + Math.cos(a) * ru, cv + Math.sin(a) * rv, z));
    }
    drawWorldPoly(this.g, pts, color, this.alpha);
  }

  /** A free quad through four footprint points with their own heights. */
  quad(points: readonly (readonly [number, number, number])[], color: number): void {
    drawWorldPoly(this.g, points.map(([u, v, z]) => this.pt(u, v, z)), color, this.alpha);
  }

  /** Horizontal slats down the south and east faces. */
  louvers(z0: number, z1: number, color: number, step = 0.09): void {
    if (!this.detail) return;
    for (let z = z0; z < z1 - 0.02; z += step) {
      this.south(0.06, 0.88, z, z + 0.025, color);
      this.east(0.06, 0.88, z, z + 0.025, color);
    }
  }

  /** A top fan: dark throat, and at full detail a guard ring and hub. */
  fan(cu: number, cv: number, ru: number, rv: number, z: number): void {
    this.disc(cu, cv, ru, rv, z + 0.01, DARK.left);
    if (!this.detail) return;
    this.disc(cu, cv, ru * 0.62, rv * 0.62, z + 0.015, DARK.right);
    this.disc(cu, cv, ru * 0.2, rv * 0.2, z + 0.02, GALV.top);
  }
}

type Painter = (pen: GearPen, b: Building, fixture: RooftopFixture, pose: RooftopPose) => void;

/** True when the fixture's long side runs along world x. */
const alongX = (f: RooftopFixture): boolean => f.axis === "x";

/** Run a painter in along/across terms: `a` 0..1 down the unit's length, `c` across it. */
function oriented(f: RooftopFixture, a: number, c: number, da: number, dc: number): [number, number, number, number] {
  return alongX(f) ? [a, c, da, dc] : [c, a, dc, da];
}

const PAINTERS: Record<RooftopKind, Painter> = {
  "exhaust-hood": (pen) => {
    pen.box(0.08, 0.08, 0.84, 0.84, 0, 0.14, CURB);
    pen.box(0.3, 0.3, 0.4, 0.4, 0.14, 0.2, GALV);
    pen.box(0.04, 0.04, 0.92, 0.92, 0.34, 0.14, SPUN);
    pen.disc(0.5, 0.5, 0.34, 0.34, 0.49, SPUN.right);
    pen.box(0.34, 0.34, 0.32, 0.32, 0.48, 0.12, SPUN);
  },
  "duct-run": (pen, _b, f) => {
    for (const a of [0.12, 0.8]) pen.box(...oriented(f, a, 0.2, 0.06, 0.6), 0, 0.12, DARK);
    pen.box(...oriented(f, 0, 0.08, 1, 0.84), 0.1, 0.26, GALV);
    if (!pen.detail) return;
    for (let a = 0.12; a < 1; a += 0.2) pen.top(...oriented(f, a, 0.08, 0.02, 0.84), 0.365, GALV.left, 0.7);
  },
  "mua-box": (pen) => {
    pen.box(0.04, 0.04, 0.92, 0.92, 0, 0.1, CURB);
    pen.box(0, 0, 1, 1, 0.1, 0.4, GALV);
    pen.south(0.12, 0.76, 0.18, 0.42, PAL.louver);
    pen.louvers(0.2, 0.42, GALV.right, 0.07);
    pen.box(0.3, 0.86, 0.4, 0.2, 0.3, 0.14, GALV);
  },
  rtu: (pen) => {
    for (const v of [0.05, 0.82]) pen.box(0, v, 1, 0.13, 0, 0.1, DARK);
    pen.box(0, 0, 1, 1, 0.1, 0.5, GALV);
    pen.south(0.06, 0.5, 0.16, 0.54, PAL.louver);
    pen.east(0.1, 0.8, 0.16, 0.54, shade(PAL.louver, 1.2));
    pen.louvers(0.18, 0.54, GALV.left);
    pen.fan(0.68, 0.5, 0.24, 0.3, 0.6);
    if (pen.detail) pen.south(0.64, 0.26, 0.2, 0.5, GALV.right);
  },
  "rtu-large": (pen, _b, f) => {
    for (const c of [0.06, 0.82]) pen.box(...oriented(f, 0, c, 1, 0.12), 0, 0.12, DARK);
    pen.box(0, 0, 1, 1, 0.12, 0.62, GALV);
    pen.south(0.05, 0.9, 0.2, 0.68, PAL.louver);
    pen.east(0.05, 0.9, 0.2, 0.68, shade(PAL.louver, 1.2));
    pen.louvers(0.22, 0.68, GALV.left);
    for (const a of [0.3, 0.72]) { const [u, v] = oriented(f, a, 0.5, 0, 0); pen.fan(u, v, alongX(f) ? 0.15 : 0.3, alongX(f) ? 0.3 : 0.15, 0.74); }
    pen.box(...oriented(f, 0, 0.2, 0.1, 0.6), 0.3, 0.3, GALV);
  },
  "condenser-bank": (pen, _b, f) => {
    for (const c of [0.05, 0.83]) pen.box(...oriented(f, 0, c, 1, 0.12), 0, 0.14, DARK);
    pen.box(0, 0, 1, 1, 0.14, 0.4, GALV);
    pen.south(0.03, 0.94, 0.18, 0.5, PAL.louver);
    pen.east(0.03, 0.94, 0.18, 0.5, shade(PAL.louver, 1.2));
    pen.louvers(0.2, 0.5, GALV.left, 0.06);
    for (const a of [0.14, 0.38, 0.62, 0.86]) { const [u, v] = oriented(f, a, 0.5, 0, 0); pen.fan(u, v, alongX(f) ? 0.1 : 0.34, alongX(f) ? 0.34 : 0.1, 0.54); }
  },
  chiller: (pen, _b, f) => {
    pen.box(0, 0, 1, 1, 0, 0.08, CURB);
    pen.box(0.02, 0.04, 0.96, 0.92, 0.08, 0.7, GALV);
    pen.south(0.05, 0.9, 0.16, 0.7, PAL.louver);
    pen.east(0.05, 0.9, 0.16, 0.7, shade(PAL.louver, 1.2));
    pen.louvers(0.18, 0.7, GALV.left);
    for (const a of [0.2, 0.5, 0.8]) { const [u, v] = oriented(f, a, 0.5, 0, 0); pen.fan(u, v, alongX(f) ? 0.12 : 0.32, alongX(f) ? 0.32 : 0.12, 0.78); }
    if (pen.detail) pen.box(...oriented(f, 0.9, 0.3, 0.12, 0.4), 0.2, 0.36, { top: 0xd8d2b0, left: 0x8c8768, right: 0xb2ac8a });
  },
  bulkhead: (pen, b) => {
    const skin = b.construction.skin === "glass" ? "concrete" : b.construction.skin;
    const south = wallTone(b, skin, "south"), east = wallTone(b, skin, "east");
    pen.box(0.02, 0.02, 0.96, 0.96, 0, 1.2, { top: shade(east, 1.15), left: south, right: east });
    pen.box(-0.03, -0.03, 1.06, 1.06, 1.2, 0.08, DARK);
    pen.south(0.36, 0.26, 0, 0.82, 0x3a342e);
    if (!pen.detail) return;
    pen.east(0.3, 0.4, 0.5, 0.92, PAL.louver);
    pen.south(0.4, 0.18, 0.44, 0.7, 0x57504a);
  },
  "cooling-tower": (pen, _b, f) => {
    pen.box(0, 0, 1, 1, 0, 0.14, CURB);
    pen.box(0.03, 0.03, 0.94, 0.94, 0.14, 0.95, TOWER);
    pen.south(0.08, 0.84, 0.24, 0.98, shade(PAL.louver, 1.15));
    pen.east(0.08, 0.84, 0.24, 0.98, shade(PAL.louver, 1.35));
    pen.louvers(0.26, 0.98, TOWER.left, 0.1);
    for (const a of [0.28, 0.72]) {
      const [u, v] = oriented(f, a, 0.5, 0, 0);
      const ru = alongX(f) ? 0.17 : 0.34, rv = alongX(f) ? 0.34 : 0.17;
      pen.box(u - ru, v - rv, ru * 2, rv * 2, 1.09, 0.14, DARK);
      pen.fan(u, v, ru * 0.82, rv * 0.82, 1.23);
    }
  },
  "vent-stack": (pen) => {
    pen.box(0.1, 0.1, 0.8, 0.8, 0, 0.5, DARK);
    pen.box(-0.1, -0.1, 1.2, 1.2, 0.5, 0.07, GALV);
  },
  "comms-mast": (pen) => {
    pen.box(0, 0, 1, 1, 0, 0.12, CURB);
    pen.box(0.38, 0.38, 0.24, 0.24, 0.12, 2.1, { top: 0xd0d4d2, left: 0x8e2f28, right: 0xc8ccca });
    pen.box(0.1, 0.44, 0.8, 0.12, 1.5, 0.05, GALV);
    pen.box(0.2, 0.44, 0.6, 0.12, 1.9, 0.05, GALV);
    pen.box(0.62, 0.3, 0.3, 0.36, 1.1, 0.3, SPUN);
    if (pen.detail) pen.box(0.42, 0.42, 0.16, 0.16, 2.22, 0.06, { top: 0xe04a3a, left: 0x8e2f28, right: 0xb83a2e });
  },
  "roof-hatch": (pen) => {
    pen.box(0, 0, 1, 1, 0, 0.2, CURB);
    pen.quad([[0, 0, 0.3], [1, 0, 0.3], [1, 1, 0.21], [0, 1, 0.21]], GALV.top);
    if (pen.detail) pen.south(0.42, 0.16, 0.06, 0.14, DARK.left);
  },
  "turbine-vent": (pen) => {
    pen.box(0.3, 0.3, 0.4, 0.4, 0, 0.2, GALV);
    pen.box(0.04, 0.04, 0.92, 0.92, 0.2, 0.24, SPUN);
    pen.disc(0.5, 0.5, 0.4, 0.4, 0.45, SPUN.right);
    pen.louvers(0.22, 0.44, SPUN.left, 0.06);
  },
  "gooseneck-vent": (pen, _b, f) => {
    pen.box(...oriented(f, 0, 0.1, 0.45, 0.8), 0, 0.42, GALV);
    pen.box(...oriented(f, 0.4, 0.1, 0.6, 0.8), 0.24, 0.2, GALV);
    if (pen.detail) pen.south(0.5, 0.4, 0.26, 0.4, DARK.left);
  },
  "skylight-curb": (pen) => {
    pen.box(0, 0, 1, 1, 0, 0.16, CURB);
    pen.quad([[0.06, 0.06, 0.26], [0.94, 0.06, 0.26], [0.94, 0.94, 0.17], [0.06, 0.94, 0.17]], 0x7fa6b4);
    if (!pen.detail) return;
    pen.quad([[0.48, 0.06, 0.262], [0.52, 0.06, 0.262], [0.52, 0.94, 0.172], [0.48, 0.94, 0.172]], PAL.galv);
    pen.quad([[0.1, 0.12, 0.262], [0.34, 0.12, 0.262], [0.2, 0.5, 0.22], [0.1, 0.5, 0.22]], 0xb5d0d8);
  },
  "flue-stack": (pen) => {
    pen.box(-0.2, -0.2, 1.4, 1.4, 0, 0.08, CURB);
    pen.box(0.1, 0.1, 0.8, 0.8, 0.08, 0.76, DARK);
    pen.box(-0.15, -0.15, 1.3, 1.3, 0.86, 0.08, GALV);
  },
  "split-condenser": (pen) => {
    for (const u of [0.08, 0.78]) pen.box(u, 0.1, 0.14, 0.8, 0, 0.06, DARK);
    pen.box(0, 0, 1, 1, 0.06, 0.36, COOLER);
    pen.south(0.1, 0.5, 0.1, 0.38, PAL.louver);
    if (pen.detail) pen.south(0.24, 0.22, 0.17, 0.31, DARK.right);
  },
  "swamp-cooler": (pen, _b, _f, pose) => {
    // A level stand keeps the cabinet square on a pitched roof: its legs reach down to the low side.
    const sink = (Math.abs(pose.slopeX) * pose.box.w + Math.abs(pose.slopeY) * pose.box.d) / 2;
    for (const [u, v] of [[0.04, 0.04], [0.84, 0.04], [0.04, 0.84], [0.84, 0.84]] as const) pen.box(u, v, 0.12, 0.12, -sink, 0.14 + sink, DARK);
    pen.box(0, 0, 1, 1, 0.14, 0.46, COOLER);
    pen.south(0.1, 0.8, 0.2, 0.54, 0x5d5a4c);
    pen.east(0.1, 0.8, 0.2, 0.54, 0x716e5f);
    pen.louvers(0.22, 0.54, COOLER.left, 0.07);
  },
  "solar-array": (pen, _b, _f, pose) => {
    const pitched = pose.slopeX !== 0 || pose.slopeY !== 0;
    // On a slope the modules lie flush with the roof; on a flat deck a rack tilts them to the south.
    const at = (u: number, v: number, lift: number): readonly [number, number, number] =>
      [u, v, pitched ? lift + (u - 0.5) * pose.box.w * pose.slopeX + (v - 0.5) * pose.box.d * pose.slopeY : lift + (1 - v) * 0.34];
    if (!pitched) for (const u of [0.08, 0.86]) pen.box(u, 0.02, 0.06, 0.1, 0, 0.4, DARK);
    pen.quad([at(0, 0, 0.07), at(1, 0, 0.07), at(1, 1, 0.07), at(0, 1, 0.07)], PAL.galvDark);
    pen.quad([at(0.03, 0.04, 0.08), at(0.97, 0.04, 0.08), at(0.97, 0.96, 0.08), at(0.03, 0.96, 0.08)], PAL.solarCell);
    if (!pen.detail) return;
    for (const u of [0.26, 0.5, 0.74]) pen.quad([at(u - 0.01, 0.04, 0.085), at(u + 0.01, 0.04, 0.085), at(u + 0.01, 0.96, 0.085), at(u - 0.01, 0.96, 0.085)], 0x8fa3c4);
    pen.quad([at(0.03, 0.49, 0.085), at(0.97, 0.49, 0.085), at(0.97, 0.51, 0.085), at(0.03, 0.51, 0.085)], 0x8fa3c4);
  },
};

/** One rooftop fixture where its roof currently holds it (or mid-fall), faded with that roof. */
export function drawRooftopFixture(g: Graphics, b: Building, fixture: RooftopFixture, alpha: number, detail: boolean, snow = false): void {
  if (!rooftopVisibleAt(fixture.kind, detail)) return;
  const pose = rooftopPose(b, fixture);
  if (!pose) return;
  PAINTERS[fixture.kind](new GearPen(g, pose, alpha, detail, snow), b, fixture, pose);
}

/** Height of a fixture kind above its deck, for cull boxes. */
export function rooftopHeight(kind: RooftopKind): number {
  return ROOFTOP_KINDS[kind].h;
}
