import { describe, expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { createRoadVehicle, stepRoadVehicle } from "../vehicle/roadVehicle";
import { createTown } from "./town";
import { findRoadRoute, makeCurveCrossFixture } from "./roads";
import {
  civilianMustStayOnRoad,
  findTrafficRoute,
  pickVerificationRoute,
  policeMayLeaveRoad,
  routeUsesCurveAndIntersection,
} from "./routing";

describe("traffic and police routing contracts", () => {
  it("keeps civilians on valid roads", () => {
    const net = makeCurveCrossFixture();
    expect(civilianMustStayOnRoad()).toBe(true);
    const start = net.nodes.find((n) => n.id === "w")!;
    const dest = net.nodes.find((n) => n.id === "e")!;
    const ok = findTrafficRoute(net, {
      startX: start.x,
      startY: start.y,
      destX: dest.x,
      destY: dest.y,
      role: "civilian",
      dozerNearby: true,
      pursuitAllowed: true,
      offRoadBlocked: false,
      destOnRoad: true,
    });
    expect(ok.ok).toBe(true);
    expect(ok.mode).toBe("road");
    const off = findTrafficRoute(net, {
      startX: start.x,
      startY: start.y,
      destX: 40,
      destY: 40,
      role: "civilian",
      dozerNearby: true,
      pursuitAllowed: true,
      offRoadBlocked: false,
      destOnRoad: false,
    });
    expect(off.ok).toBe(false);
    expect(off.mode).toBe("inaccessible");
  });

  it("lets police leave the road only during nearby permitted pursuit", () => {
    expect(policeMayLeaveRoad({ dozerNearby: false, pursuitAllowed: true, offRoadBlocked: false })).toBe(false);
    expect(policeMayLeaveRoad({ dozerNearby: true, pursuitAllowed: false, offRoadBlocked: false })).toBe(false);
    expect(policeMayLeaveRoad({ dozerNearby: true, pursuitAllowed: true, offRoadBlocked: true })).toBe(false);
    expect(policeMayLeaveRoad({ dozerNearby: true, pursuitAllowed: true, offRoadBlocked: false })).toBe(true);
    const net = makeCurveCrossFixture();
    const blocked = findTrafficRoute(net, {
      startX: 2,
      startY: 10,
      destX: 40,
      destY: 40,
      role: "police",
      dozerNearby: false,
      pursuitAllowed: true,
      offRoadBlocked: false,
      destOnRoad: false,
    });
    expect(blocked.mode).toBe("inaccessible");
    const chase = findTrafficRoute(net, {
      startX: 2,
      startY: 10,
      destX: 40,
      destY: 40,
      role: "police",
      dozerNearby: true,
      pursuitAllowed: true,
      offRoadBlocked: false,
      destOnRoad: false,
    });
    expect(chase.ok).toBe(true);
    expect(chase.mode).toBe("offroad-pursuit");
  });

  it("drives a verification vehicle through a curve and intersection", () => {
    const town = createTown({ district: "d10", seed: 0x51a11 });
    const path = pickVerificationRoute(town.network);
    expect(path).toBeTruthy();
    const car = createRoadVehicle(town.roadSpawnX, town.roadSpawnY, town.roadSpawnHeading, path ?? []);
    town.roadCar = car;
    const origin = { x: car.x, y: car.y };
    for (let i = 0; i < 240; i++) stepRoadVehicle(car, town, SIM_DT);
    expect(Math.hypot(car.x - origin.x, car.y - origin.y)).toBeGreaterThan(4);
    const fixture = makeCurveCrossFixture();
    const fromLane = fixture.lanes.find((l) => l.dir === 1 && fixture.segments.find((s) => s.id === l.segmentId)?.startId === "w")!;
    const toLane = fixture.lanes.find((l) => l.dir === 1 && fixture.segments.find((s) => s.id === l.segmentId)?.endId === "s")!;
    const fixturePath = findRoadRoute(fixture, fromLane.id, toLane.id);
    expect(fixturePath).toBeTruthy();
    expect(routeUsesCurveAndIntersection(fixture, fixturePath!)).toBe(true);
  });
});
