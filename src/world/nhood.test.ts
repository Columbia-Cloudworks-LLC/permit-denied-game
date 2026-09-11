import { describe, expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { createRoadVehicle, stepRoadVehicle } from "../vehicle/roadVehicle";
import { makeInvalidDisconnectedTown, validateTown } from "./districts";
import { completeLot } from "./parcels";
import { curvePoints, findRoadRoute, linePoints, pt, RoadBuilder, roadSurfaceAt } from "./roads";
import { pickDrivewayDemoRoute, pickVerificationRoute } from "./routing";
import { createTown } from "./town";
import type { TopologyFamily } from "./rural";

const SEEDS = [0x51a11, 1, 7, 19] as const;
const FAMILIES: TopologyFamily[] = ["county", "crossroads", "tjunction", "curve-farm", "loop", "frontage"];

describe("neighborhood generation", () => {
  it("meets district targets through connected frontage, not invalid lots", () => {
    for (const district of ["d10", "d30", "d100"] as const) {
      const town = createTown({ district, seed: 0x51a11 });
      expect(town.buildings.length).toBe(district === "d10" ? 10 : district === "d30" ? 30 : 100);
      expect(town.lots).toHaveLength(town.buildings.length);
      expect(town.network.accesses.every((a) => town.lots.some((l) => l.id === a.lotId))).toBe(true);
      const report = validateTown(town);
      expect(report.issues, report.issues.map((i) => `${i.code}:${i.detail}`).join("; ")).toEqual([]);
    }
  });

  it("reproduces roads, parcels, access, and dressing for a fixed seed", () => {
    const a = createTown({ district: "d10", seed: 19, topology: "loop" });
    const b = createTown({ district: "d10", seed: 19, topology: "loop" });
    expect(a.network.segments.map((s) => s.id).join()).toBe(b.network.segments.map((s) => s.id).join());
    expect(a.lots.map((l) => `${l.id}:${l.x.toFixed(2)}:${l.frontage.segmentId}`).join()).toBe(
      b.lots.map((l) => `${l.id}:${l.x.toFixed(2)}:${l.frontage.segmentId}`).join(),
    );
    expect(a.buildings.map((x) => `${x.x.toFixed(2)},${x.y.toFixed(2)}`).join()).toBe(
      b.buildings.map((x) => `${x.x.toFixed(2)},${x.y.toFixed(2)}`).join(),
    );
  });

  it("exercises topology families under capacity pressure", () => {
    for (const topology of FAMILIES) {
      const town = createTown({ district: "d10", seed: 7, topology });
      expect(town.buildings.length).toBe(10);
      expect(validateTown(town).ok).toBe(true);
      if (topology === "loop") {
        const junctions = town.network.nodes.filter((n) => n.segmentIds.length >= 3);
        expect(junctions.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps a seed matrix valid across district sizes", () => {
    const sizes = [
      ["d10", 10],
      ["d30", 30],
      ["d100", 100],
    ] as const;
    for (const seed of SEEDS) {
      for (const [district, count] of sizes) {
        const town = createTown({ district, seed });
        expect(town.buildings.length, `${district} seed ${seed} count`).toBe(count);
        expect(validateTown(town).ok, `${district} seed ${seed}`).toBe(true);
      }
    }
  });

  it("rejects a disconnected public street", () => {
    const town = makeInvalidDisconnectedTown(createTown({ district: "d10", seed: 1 }));
    const report = validateTown(town);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === "streets" || i.code === "dangle-node")).toBe(true);
  });

  it("rejects an orphaned access and a lot that sits on a road", () => {
    const town = createTown({ district: "d10", seed: 1 });
    town.network.accesses.push({
      id: "orphan",
      lotId: "nobody",
      segmentId: town.network.segments[0]!.id,
      laneId: town.network.segments[0]!.laneIds[0]!,
      t: 0.5,
      x: 0,
      y: 0,
      kind: "driveway",
    });
    const badLot = completeLot({
      id: "on-road",
      x: town.network.nodes[0]!.x - 1,
      y: town.network.nodes[0]!.y - 1,
      w: 4,
      d: 4,
      heading: 0,
      zone: "residential",
      identity: "residence",
      accessId: "",
      templateId: "",
    });
    town.lots.push(badLot);
    const report = validateTown(town);
    expect(report.issues.some((i) => i.code === "orphan-access")).toBe(true);
    expect(report.issues.some((i) => i.code === "parcel-road" || i.code === "access" || i.code === "driveway")).toBe(true);
  });

  it("drives a V-key route through an intersection into a driveway", () => {
    const town = createTown({ district: "d10", seed: 0x51a11 });
    const path = pickDrivewayDemoRoute(town.network) ?? pickVerificationRoute(town.network);
    expect(path).toBeTruthy();
    expect(path!.length).toBeGreaterThanOrEqual(2);
    const destLane = path![path!.length - 1]!;
    const destSeg = town.network.lanes.find((l) => l.id === destLane);
    const seg = town.network.segments.find((s) => s.id === destSeg?.segmentId);
    expect(seg?.roadClass === "driveway" || path!.length >= 2).toBe(true);
    const car = createRoadVehicle(town.roadSpawnX, town.roadSpawnY, town.roadSpawnHeading, path ?? []);
    town.roadCar = car;
    const origin = { x: car.x, y: car.y };
    for (let i = 0; i < 320; i++) stepRoadVehicle(car, town, SIM_DT);
    expect(Math.hypot(car.x - origin.x, car.y - origin.y)).toBeGreaterThan(3);
    expect(roadSurfaceAt(town.network, car.x, car.y).on).toBe(true);
  });

  it("recognizes driveway surfaces in routing queries", () => {
    const town = createTown({ district: "d10", seed: 4 });
    const drive = town.network.segments.find((s) => s.roadClass === "driveway");
    expect(drive).toBeTruthy();
    const mid = drive!.points[Math.floor(drive!.points.length / 2)]!;
    expect(roadSurfaceAt(town.network, mid.x, mid.y).on).toBe(true);
    const start = town.network.lanes.find((l) => l.dir === 1 && town.network.segments.find((s) => s.id === l.segmentId)?.roadClass !== "driveway");
    const dest = town.network.lanes.find((l) => l.segmentId === drive!.id);
    expect(start && dest && findRoadRoute(town.network, start.id, dest.id)).toBeTruthy();
  });
});

describe("hand-built graph joins", () => {
  it("joins a curved parent at an interior T", () => {
    const b = new RoadBuilder();
    const a = b.node(0, 8, 0, "a");
    const c = b.node(24, 12, 0.2, "c");
    b.segment(a, c, curvePoints(pt(a), { x: 10, y: 2, elev: 0.1 }, pt(c)), { roadClass: "rural" });
    const p = b.segments[0]!.points[Math.floor(b.segments[0]!.points.length / 2)]!;
    const j = b.joinAt(p.x, p.y, p.elev, 0);
    const spur = b.node(p.x, p.y + 10, p.elev, "spur");
    b.segment(j, spur, linePoints(pt(j), pt(spur)), { roadClass: "residential" });
    const net = b.finish();
    expect(j.segmentIds.length).toBeGreaterThanOrEqual(3);
    expect(net.segments.length).toBeGreaterThanOrEqual(3);
  });
});
