import { drawVehicleAssembly, vehicleRenderGroups } from './modularVehicle';
import { BowlingStrikes } from './bowlingStrikes';
import { corePileAreas, drawCorePiles } from './corePileDraw';
import { drawCoreFloor } from './coreCollapseDraw';
import { paintsFloorSlab } from '../structure/coreCollapse';
import { cellWorldBox, cellPresent } from '../structure/types';
import { DrawCache } from './drawCache';
import type { YardBay } from '../world/yardCatalog';
import { defaultDebugView } from "../debug/view";
import { drawDebugOverlay } from "./debugOverlay";
import { Container, Graphics, Text } from "pixi.js";
import { DOZER, FLOOR_Z } from "../game/constants";
import { Rng } from "../game/rng";
import { depthKey, screenAabbVisible, worldBoundsToScreen, worldToScreen } from "../world/iso";
import type { ParticlePool } from "../fx/particles";
import { applyBrokenRoofEdge, displacedRoofVerts, roofHeightAt, sectionOwnsRidge, sawtoothClosures } from "../structure/roof";
import type { Bird, Building, CollapsedSite, CoverKind, GroundMark, GroundPatch, Particle, RoofSection, Rubble } from "../structure/types";
import type { FieldFeature, TerrainFeature } from "../world/terrainFeatures";
import type { Dozer } from "../vehicle/dozer";
import type { Town } from "../world/town";
import { getBuildingSurfaces, releaseBuildingSurfaces } from "./buildingSurfaces";
import { wallPaintSpans } from "./wallPaint";
import { drawCatalogProp } from "./assets";
import { drawRoofFrame, interiorCmds, roofCommandDepth, roofShowsFrame } from "./interiorDraw";
import { cellColors, drawGroundPoly, drawIsoBox, drawOrientedGround, drawOrientedIsoBox, drawShadow, drawSlopedQuad, drawWorldPoly, PAL, shade } from "./drawIso";
import {
  drawBuildingFootprintShadow,
  drawFallingCell,
  drawWallSpan,
} from "./facadeDraw";
import { roofSlopeLight } from "./lighting";
import { drawDozer } from "./vehicles";
import { facadeDetailCommand } from './facadeDetails';
import { elevatedTankCommands } from './elevatedTank';
import { siloCommands } from './silos';
import { drawNhoodOverlay } from "./nhoodOverlay";
import { buildingHidesDozer, objectOcclusionFade, pieceHidesDozer, VisibilityFades, wallSpanFadeRuns } from "./occlusion";
import {
  buildingDamaged,
  buildingIsLive,
  buildingLod,
  buildingNeedsDetails,
  buildingNeedsInterior,
  coalesceStaticChunks,
  debugViewSignature,
} from "./buildingLod";

interface Cmd {
  floor?: number;
  key?: string;
  version?: string | number;
  chunk?: string;
  depth: number;
  run: (g: Graphics) => void;
}

export class WorldRenderer {
  readonly root = new Container();
  readonly bowlingStrikes = new BowlingStrikes();
  yardPreview: YardBay[] = [];
  yardPreviewValid = true;
  private yardLabels: Text[] = [];
  private yardLabelKey = "";
  private readonly ground = new Graphics();
  private readonly sites = new Graphics();
  private readonly overlay = new Graphics();
  private readonly nhood = new Graphics();
  private readonly nhoodLabels: Text[] = [];
  private readonly world = new Graphics();
  private readonly groundOverlays = new Graphics();
  private readonly drawing = new DrawCache();
  private readonly cmds: Cmd[] = [];
  private readonly staticBuildingCmds = new WeakMap<Building, { key: string; cmds: Cmd[]; visible: number }>();
  readonly debug = defaultDebugView();
  jobTarget?: Building;
  landmarkTarget?: Building;
  readonly hudOverlay = new Container();
  private readonly landmarkPin = new Graphics();
  private readonly landmarkArrow = new Graphics();
  private readonly fades = new VisibilityFades();
  private readonly debugOverlay = new Graphics();
  get showNhood(): boolean { return this.debug.overview; }
  set showNhood(value: boolean) { this.debug.overview = value; }
  camX = 0;
  camY = 0;
  zoom = 1.15;
  private viewW = 1;
  private viewH = 1;
  private groundKey = "";
  private overlayKey = "";
  private siteKey = "";
  stats = { total: 0, visible: 0, commands: 0, surfaceGeometry: 0, cached: 0, rebuilt: 0 };
  dozerHidden = false;

  constructor() {
    this.root.addChild(this.ground, this.sites, this.overlay, this.groundOverlays, this.drawing.root, this.world, this.nhood, this.debugOverlay);
    this.root.addChild(this.bowlingStrikes.root, this.landmarkPin);
    this.hudOverlay.addChild(this.landmarkArrow);
    this.root.sortableChildren = false;
  }

  invalidate(): void {
    this.drawing.clear();
    this.groundKey = "";
    this.overlayKey = "";
    this.siteKey = "";
  }

  layout(viewW: number, viewH: number, shakeX: number, shakeY: number): void {
    this.viewW = viewW;
    this.viewH = viewH;
    this.root.position.set(viewW / 2 - this.camX + shakeX, viewH / 2 - this.camY + shakeY);
    this.root.scale.set(this.zoom);
  }

  private visibleBox(x: number, y: number, w: number, d: number, z0: number, z1: number): boolean {
    return screenAabbVisible(
      worldBoundsToScreen(x, y, w, d, z0, z1),
      this.viewW,
      this.viewH,
      this.camX,
      this.camY,
      this.zoom,
    );
  }

  draw(town: Town, dozer: Dozer, particles: ParticlePool, birds: Bird[], dt = 1 / 60, showPlayer = true): void {
    const strikeAt = worldToScreen(dozer.x, dozer.y);
    this.bowlingStrikes.draw(dt, strikeAt.x, strikeAt.y, this.zoom);
    this.root.setChildIndex(this.bowlingStrikes.root, this.root.children.length - 1);
    this.fades.begin();
    const view = this.debug;
    this.sites.visible = view.sites;
    this.nhood.visible = this.showNhood;
    this.world.clear();
    this.groundOverlays.clear();
    const yardKey = town.yard ? `${town.seed}:${town.yard.bays.map(b => b.key).join(',')}` : '';
    if (yardKey !== this.yardLabelKey) {
      for (const label of this.yardLabels) label.destroy();
      this.yardLabels = [];
      for (const bay of town.yard?.bays ?? []) {
        const label = new Text({ text: `${bay.asset.category} / ${bay.asset.name}`, style: { fontSize: 10, fill: 0xffe7a0, fontFamily: 'monospace' } });
        const p = worldToScreen(bay.x, bay.y); label.position.set(p.x, p.y); this.root.addChild(label); this.yardLabels.push(label);
      }
      this.yardLabelKey = yardKey;
    }
    for (const b of this.yardPreview) drawOrientedGround(this.groundOverlays, b.x + b.w / 2, b.y + b.d / 2, 0, b.w, b.d, this.yardPreviewValid ? 0x55ff99 : 0xff5555, .3, .03);

    this.cmds.length = 0;
    let total = 0;
    let visible = 0;
    let occluded = false;

    const gKey = `${view.terrain}:${view.roads}:${town.district}:${town.seed}:${town.lots.length}:${town.network.mesh.length}:${town.ground.length}:${town.features?.length ?? 0}:${town.featureRevision ?? 0}`;
    if (gKey !== this.groundKey) {
      this.ground.clear();
      const covers = town.ground.length
        ? town.ground
        : town.lots.map((lot) => ({
            x: lot.x,
            y: lot.y,
            w: lot.w,
            d: lot.d,
            heading: 0,
            cover: "lot" as CoverKind,
            seed: town.seed,
            z: 0,
          }));
      for (const patch of view.terrain ? covers : []) {
        drawCover(this.ground, patch);
      }
      if (view.terrain) drawTerrainFeatures(this.ground, town.features ?? []);
      const mesh = town.network.mesh;
      if (view.roads && mesh.length) {
        // RoadMeshQuad x/y are world centers; drawOrientedGround uses the same convention.
        for (const q of mesh) {
          const alpha = q.kind === "mark" ? 0.72 : 1;
          if (q.poly && q.poly.length >= 3) {
            drawWorldPoly(
              this.ground,
              q.poly.map((p) => ({ x: p.x, y: p.y, z: q.z })),
              q.color,
              alpha,
            );
          } else {
            drawOrientedGround(this.ground, q.x, q.y, q.heading, q.w, q.d, q.color, alpha, q.z);
          }
        }
      } else if (view.roads) {
        for (const road of town.roads) {
          drawGroundPoly(this.ground, road.x, road.y, road.w, road.d, PAL.asphalt);
        }
      }
      this.groundKey = gKey;
    }

    const sKey = `${town.siteRevision}:${town.collapsedSites.length}`;
    if (sKey !== this.siteKey) {
      this.sites.clear();
      for (const site of town.collapsedSites) drawCollapsedSite(this.sites, site);
      this.siteKey = sKey;
    }

    const camCell = `${Math.round(this.camX / 28)}:${Math.round(this.camY / 28)}`;
    const oKey = `${view.effects}:${view.debris}:${town.visualRevision}:${town.pile.revision}:${camCell}`;
    if (oKey !== this.overlayKey) {
      this.overlay.clear();
      for (const mark of view.effects ? town.marks : []) {
        total++;
        if (!this.visibleBox(mark.x - mark.w, mark.y - mark.d, mark.w * 2, mark.d * 2, 0, 0.02)) continue;
        visible++;
        drawGroundMark(this.overlay, mark);
      }
      if (view.debris) drawPileHints(this.overlay, town, (x, y, w, d) => this.visibleBox(x, y, w, d, 0, 3.5));
      this.overlayKey = oKey;
    }

    if (this.showNhood) drawNhoodOverlay(this.nhood, this.nhoodLabels, town);
    else this.nhood.clear();
    for (const label of this.nhoodLabels) {
      if (!label.parent) this.nhood.addChild(label);
    }

    let surfaceGeometry = 0;
    const viewSig = debugViewSignature(view);
    const camLod = `${Math.round(this.camX / 40)}:${Math.round(this.camY / 40)}:${this.zoom.toFixed(2)}:${this.viewW}x${this.viewH}`;
    const hideDressing = view.overview || this.zoom < 0.55;
    for (const b of town.buildings) {
      if (b.retired) { releaseBuildingSurfaces(b); continue; }
      const commandStart = this.cmds.length;
      const fadeValues: number[] = [];
      const bw = b.w * b.cellSize;
      const bd = b.d * b.cellSize;
      const z1 = b.floors * FLOOR_Z + (b.elevatedTank ? b.elevatedTank.definition.height + .5 : .8);
      const fall = 1.4;
      total += b.cells.length;
      if (!this.visibleBox(b.x - fall, b.y - fall, bw + fall * 2, bd + fall * 2, -0.4, z1)) continue;
      if (buildingHidesDozer(dozer, b)) occluded = true;
      if(b.elevatedTank) {
        const commands=elevatedTankCommands(b,view);visible+=commands.length;this.cmds.push(...commands);continue;
      }
      if(b.silos){const commands=siloCommands(b,view);visible+=commands.length;this.cmds.push(...commands);}
      // The aggregate mound owns the finished visual; a ground slab must not paint over it.
      if (b.coreCollapse?.phase === 'settled') continue;
      if (b.coreCollapse?.phase === 'falling') {
        for (const rect of b.coreCollapse.floors) {
          const z = rect.floor * FLOOR_Z - b.coreCollapse.drop;
          if (z + FLOOR_Z <= 0) continue;
          visible++;
          this.cmds.push({ depth: depthKey(b.x + (rect.x + rect.w / 2) * b.cellSize, b.y + (rect.y + rect.d / 2) * b.cellSize, Math.max(0, z)), key: `core:${b.id}:${rect.floor}:${rect.x}:${rect.y}`, version: b.visualRevision, run: g => drawCoreFloor(g, b, rect, Math.min(3.5, town.pile.sample(b.x + bw / 2, b.y + bd / 2).height)) });
        }
        continue;
      }
      const near = dozer.x > b.x - 6 && dozer.x < b.x + bw + 6 && dozer.y > b.y - 6 && dozer.y < b.y + bd + 6;
      const lod = buildingLod(near, view.overview, this.zoom);
      const damaged = buildingDamaged(b);
      const live = buildingIsLive(lod, damaged);
      const needsInterior = buildingNeedsInterior(b, view, lod);
      const needsDetails = buildingNeedsDetails(view, lod);
      const cacheKey = live ? "" : `${b.visualRevision}:${viewSig}:${camLod}:${needsInterior ? 1 : 0}:${needsDetails ? 1 : 0}`;
      if (cacheKey) {
        const hit = this.staticBuildingCmds.get(b);
        if (hit && hit.key === cacheKey) {
          visible += hit.visible;
          this.cmds.push(...hit.cmds);
          continue;
        }
      }
      for (const c of b.cells) if (c.coreSupport && cellPresent(c) && view.walls) {
        const box = cellWorldBox(b, c);
        const alpha = !live || view.reveal || view.maxFloor === 0 ? 1 : objectOcclusionFade(dozer, box.x, box.y, box.w, box.d, 0, FLOOR_Z);
        this.cmds.push({ depth: depthKey(box.x + .3, box.y + .3, .1), run: g => drawIsoBox(g, box.x, box.y, box.w, box.d, 0, FLOOR_Z, 0xb6a784, 0x827754, 0x9c8d68, alpha) });
      }
      const surfaces = getBuildingSurfaces(b);

      surfaceGeometry += surfaces.geometryCount;
      const fadeBox = (key: string, x: number, y: number, w: number, d: number, z: number, top: number) => {
        if (!live) return 1;
        const alpha = this.fades.sample(`${b.id}:${key}`, objectOcclusionFade(dozer, x, y, w, d, z, top), dt);
        fadeValues.push(Math.round(alpha * 1000));
        if (alpha < .6 || pieceHidesDozer(dozer, x, y, w, d, z, top)) occluded = true;
        return alpha;
      };
      if (this.jobTarget === b) {
        const inset = .3;
        for (const [x, y, w, d] of [[b.x - inset, b.y - inset, bw + inset * 2, .07],
          [b.x - inset, b.y + bd + inset, bw + inset * 2, .07],
          [b.x - inset, b.y - inset, .07, bd + inset * 2], [b.x + bw + inset, b.y - inset, .07, bd + inset * 2]]) {
          drawGroundPoly(this.groundOverlays, x!, y!, w!, d!, 0xd5b568, .65);
        }
      }
      const hasSolid = b.cells.some((c) => c.state !== "gone" && c.state !== "falling");
      if (hasSolid && view.walls) {
        visible++;
        // Ground layer only: a depth-sorted footprint shadow paints over far gable bays.
        drawBuildingFootprintShadow(this.groundOverlays, surfaces.footprint, 1);
      }
      for (const detail of needsDetails ? b.facadeDetails : []) {
        if (detail.floor > view.maxFloor) continue;
        const z0 = detail.floor * FLOOR_Z;
        if (!this.visibleBox(
          b.x + detail.gx * b.cellSize,
          b.y + detail.gy * b.cellSize,
          (detail.side === "south" ? detail.width : 1) * b.cellSize,
          (detail.side === "east" ? detail.width : 1) * b.cellSize,
          z0,
          z0 + FLOOR_Z,
        )) continue;
        const command = facadeDetailCommand(b, detail, fadeBox(`detail:${detail.id}`,
          b.x + detail.gx * b.cellSize, b.y + detail.gy * b.cellSize,
          (detail.side === 'south' ? detail.width : 1) * b.cellSize,
          (detail.side === 'east' ? detail.width : 1) * b.cellSize,
          detail.floor * FLOOR_Z, (detail.floor + 1) * FLOOR_Z));
        if (command) { visible++; this.cmds.push(command); }
      }
      // Split long facades only when interior slabs can cover them in painter order.
      const walls = wallPaintSpans(b, needsInterior);
      if ((b.canopy || b.openDecks) && view.walls) for (const c of b.cells) {
        if (c.state === 'gone' || c.state === 'falling' || c.floor > view.maxFloor) continue;
        if (!this.visibleBox(b.x, b.y, bw, bd, c.floor * FLOOR_Z, (c.floor + 1) * FLOOR_Z)) continue;
        const box = cellWorldBox(b, c);
        this.cmds.push({ floor:c.floor, depth: depthKey(box.x + box.w / 2, box.y + box.d / 2, c.floor * FLOOR_Z),
          run: g => drawIsoBox(g, box.x, box.y, box.w, box.d, c.floor * FLOOR_Z, FLOOR_Z, 0xb7bab0, 0x697a70, 0x8d9c91) });
      }
      if (b.openDecks) for (const tile of b.floorTiles) {
        if (tile.void || tile.state === 'gone' || tile.floor > view.maxFloor || !paintsFloorSlab(tile.floor)) continue;
        const cs=b.cellSize, x=b.x+tile.gx*cs, y=b.y+tile.gy*cs;
        const z=tile.floor*FLOOR_Z*(1-tile.fallT)+.18;
        // Low barriers belong to their deck tile and descend with it.
        if (view.walls && tile.floor>0) for (const [bx,by,bw,bd] of [
          ...(tile.gx===0 ? [[x,y,.12,cs]] : []), ...(tile.gx===b.w-1 ? [[x+cs-.12,y,.12,cs]] : []),
          ...(tile.gy===0 ? [[x,y,cs,.12]] : []), ...(tile.gy===b.d-1 ? [[x,y+cs-.12,cs,.12]] : []),
        ]) this.cmds.push({floor:tile.floor,depth:depthKey(bx!+bw!/2,by!+bd!/2,z),run:g=>drawIsoBox(g,bx!,by!,bw!,bd!,z,.45*(1-tile.fallT),0xb9b7a8,0x777f75,0x929b8e)});
        // Short end-of-deck parking bays stay clear of the alternating ramp lanes.
        if(needsDetails && tile.gx>=b.w-3 && tile.gx<b.w-1 && [2,5,8].includes(tile.gy))
          this.cmds.push({floor:tile.floor,depth:depthKey(x+cs/2,y+.02,z+.01),run:g=>drawIsoBox(g,x,y,cs,.055,z,.012,0xe0dfc7,0xe0dfc7,0xe0dfc7)});
      }
      for (const span of view.walls && !b.canopy && !b.openDecks ? walls : []) {
        if (span.floor > view.maxFloor) continue;
        const cs = b.cellSize;
        const wallX = b.x + (span.dir === "east" ? span.gx0 + 1 : span.gx0) * cs;
        const wallY = b.y + (span.dir === "south" ? span.gy0 + 1 : span.gy0) * cs;
        const wallW = span.dir === "east" ? .08 : (span.gx1 - span.gx0 + 1) * cs;
        const wallD = span.dir === "south" ? .08 : (span.gy1 - span.gy0 + 1) * cs;
        const wallZ = span.floor * FLOOR_Z;
        const wallTop = (span.floor + 1) * FLOOR_Z;
        if (!this.visibleBox(wallX, wallY, wallW, wallD, wallZ, wallTop)) continue;
        const runs = live ? wallSpanFadeRuns(b, span, dozer) : [{ span, fade: 1 }];
        for (const run of runs) {
          const s = run.span;
          const runX = b.x + (s.dir === "east" ? s.gx0 + 1 : s.gx0) * cs;
          const runY = b.y + (s.dir === "south" ? s.gy0 + 1 : s.gy0) * cs;
          const runW = s.dir === "east" ? .08 : (s.gx1 - s.gx0 + 1) * cs;
          const runD = s.dir === "south" ? .08 : (s.gy1 - s.gy0 + 1) * cs;
          const alpha = live
            ? this.fades.sample(`${b.id}:wall:${s.dir}:${s.floor}:${s.gx0}:${s.gy0}`,
              Math.min(run.fade, objectOcclusionFade(dozer, runX, runY, runW, runD, wallZ, wallTop)), dt)
            : 1;
          if (live) {
            fadeValues.push(Math.round(alpha * 1000));
            if (alpha < .6 || pieceHidesDozer(dozer, runX, runY, runW, runD, wallZ, wallTop)) occluded = true;
          }
          visible++;
          this.cmds.push({
            key: `building:${b.id}:wall:${s.dir}:${s.floor}:${s.gx0}:${s.gy0}`,
            depth: run.span.depth,
            run: (g) => drawWallSpan(g, b, run.span, alpha),
          });
        }
      }
      if (needsInterior) {
        const interiors = interiorCmds(b, 1, { fadeBox, reveal: view.reveal || b.openDecks || b.construction.skin === 'glass' || !view.roofs || !view.walls || view.maxFloor < b.floors - 1, maxFloor: view.maxFloor })
          .filter(c => c.kind === "floor" ? view.floors : c.kind === "fixture" ? view.contents : view.walls);
        visible += interiors.length;
        this.cmds.push(...interiors);
      }
      for (const cell of b.cells) {
        if (!view.walls || cell.floor > view.maxFloor || cell.state !== "falling") continue;
        const cx = b.x + cell.gx * b.cellSize + cell.fallDx * cell.fallT * 0.85;
        const cy = b.y + cell.gy * b.cellSize + cell.fallDy * cell.fallT * 0.85;
        visible++;
        this.cmds.push({
          depth: depthKey(
            b.x + (cell.gx + 0.5) * b.cellSize + cell.fallDx * cell.fallT,
            b.y + (cell.gy + 0.5) * b.cellSize + cell.fallDy * cell.fallT,
            cell.floor * FLOOR_Z,
          ),
          run: (g) => {
            drawShadow(g, cx, cy, b.cellSize, b.cellSize, 0.18);
            drawFallingCell(g, b, cell, 1);
          },
        });
      }
      const liveRoofs = b.roofs.filter((roof) => roof.state !== "gone" && roof.floor <= view.maxFloor);
      if (view.roofs && liveRoofs.length) {
        total += liveRoofs.length;
        {
          for (const roof of liveRoofs) {
            const moved = roofVerts(roof);
            const xs = moved.map(v => v.x), ys = moved.map(v => v.y), zs = moved.map(v => v.z);
            const rx = Math.min(...xs), ry = Math.min(...ys), rw = Math.max(...xs) - rx, rd = Math.max(...ys) - ry;
            const rz0 = Math.min(...zs), rz1 = Math.max(...zs) + .2;
            if (!this.visibleBox(rx, ry, rw, rd, rz0, rz1)) continue;
            const alpha = fadeBox(`roof:${roof.id}`, rx, ry, rw, rd, rz0, rz1);
            visible++;
            this.cmds.push({
              key: `building:${b.id}:roof:${roof.id}`,
              depth: roofCommandDepth(b, roof, moved),
              run: (g) => drawRoofBay(g, b, roof, alpha),
            });
          }
          if (b.features.chimney && lod !== "overview") {
            const ch = chimneyWorld(b);
            if (ch) {
              visible++;
              this.cmds.push({
                depth: depthKey(ch.x, ch.y, ch.z + 0.4),
                run: (g) => drawChimney(g, ch, 1),
              });
            }
          }
        }
      }
      // Whole-building culling keeps command identities stable while the camera moves.
      if (b.openDecks) {
        const decks = this.cmds.splice(commandStart).sort((a,c)=>(a.floor??-1)-(c.floor??-1)||a.depth-c.depth);
        if(decks.length) this.cmds.push({depth:Math.max(...decks.map(c=>c.depth)),run:g=>{for(const c of decks)c.run(g);}});
      }
      const version = live
        ? [b.visualRevision, dozer.x.toFixed(2), dozer.y.toFixed(2), fadeValues.join(","), viewSig].join(":")
        : [b.visualRevision, viewSig].join(":");
      const chunk = live ? undefined : `b${b.id}`;
      for (let j = commandStart; j < this.cmds.length; j++) {
        const cmd = this.cmds[j]!;
        if (!cmd.key) cmd.key = "building:" + b.id + ":" + (j - commandStart);
        cmd.version = version;
        if (chunk) cmd.chunk = chunk;
      }
      if (cacheKey) {
        this.staticBuildingCmds.set(b, {
          key: cacheKey,
          visible: this.cmds.length - commandStart,
          cmds: this.cmds.slice(commandStart),
        });
      }
    }

    for (const p of view.props && !hideDressing ? town.props : []) {
      if (p.broken) continue;
      total++;
      if (!this.visibleBox(p.x, p.y, p.w, p.d, p.elev, p.elev + 3.2)) continue;
      visible++;
      this.cmds.push({
        key: 'prop:' + p.id,
        version: [p.x, p.y, p.w, p.d, p.elev, p.heading, p.hp, JSON.stringify(p.pose)].join(':'),
        depth: depthKey(p.x + p.w / 2, p.y + p.d / 2, p.elev + 0.4),
        run: (g) => drawCatalogProp(g, p),
      });
    }

    for (const r of view.debris ? town.rubble : []) {
      total++;
      if (!this.visibleBox(r.x - r.w, r.y - r.d, r.w * 2, r.d * 2, r.elev, r.elev + r.thickness + 0.25)) continue;
      visible++;
      this.cmds.push({
        key: 'debris:' + r.id,
        version: r.sleeping ? [r.x, r.y, r.elev, r.heading, r.w, r.d, r.damage].join(':') : undefined,
        depth: depthKey(r.x, r.y, r.elev + r.thickness * 0.5),
        run: (g) => drawDebris(g, r),
      });
    }

    for(const load of town.yard?.loads??[]){const v=load.vehicle;this.cmds.push({depth:depthKey(v.x,v.y,load.z)+3000,run:g=>drawOrientedIsoBox(g,v.x,v.y,v.heading,3.5,2.2,load.z,.25,0x9da5a0,0x565d5a,0x7c8580)});}
    for(const v of view.vehicles ? town.vehicles : []) for(const group of vehicleRenderGroups(v)) {
      total++;
      if(!screenAabbVisible(group.bounds,this.viewW,this.viewH,this.camX,this.camY,this.zoom))continue;
      visible++;
      this.cmds.push({key:'vehicle:'+v.id+':'+group.roots.join(','),version:[v.revision,v.x,v.y,v.heading,v.elev,v.pitch,v.roll,v.steer,v.debugParts].join(':'),depth:group.depth,run:g=>drawVehicleAssembly(g,v,group.roots)});
    }

    if (view.vehicles && showPlayer) {
      total++;
      visible++;
      this.cmds.push({
        depth: depthKey(dozer.x, dozer.y, 0.4),
        run: (g) => drawDozer(g, dozer),
      });
    }

    for (const p of view.effects ? particles.items : []) {
      if (!p.alive) continue;
      total++;
      if (!this.visibleBox(p.x - 0.3, p.y - 0.3, 0.6, 0.6, 0, p.z + 0.2)) continue;
      visible++;
      this.cmds.push({
        depth: depthKey(p.x, p.y, p.z),
        run: (g) => drawParticle(g, p),
      });
    }

    for (const bird of view.effects ? birds : []) {
      total++;
      if (!this.visibleBox(bird.x - 0.4, bird.y - 0.4, 0.8, 0.8, bird.z, bird.z + 0.2)) continue;
      visible++;
      this.cmds.push({
        depth: depthKey(bird.x, bird.y, bird.z),
        run: (g) => drawBird(g, bird),
      });
    }

    this.cmds.sort((a, b) => a.depth - b.depth);
    const submitted = coalesceStaticChunks(this.cmds);
    this.drawing.draw(submitted);
    const hidden = occluded && !view.overview;
    this.dozerHidden = hidden;
    if (hidden) {
      const fx = Math.cos(dozer.heading), fy = Math.sin(dozer.heading);
      const point = (along: number, across: number) => {
        const p = worldToScreen(dozer.x + fx * along - fy * across, dozer.y + fy * along + fx * across, .5);
        return [p.x, p.y];
      };
      // Same open chevron and blade edge as before; stroke scales with zoom so street camera keeps it readable.
      const stroke = 6 / Math.max(0.4, this.zoom);
      this.world.poly([...point(-.4, -.4), ...point(.5, 0), ...point(-.4, .4)], false);
      this.world.stroke({ color: 0xffe39a, width: stroke, alpha: .75 });
      this.world.poly([...point(DOZER.bladeReach, -DOZER.bladeHalf), ...point(DOZER.bladeReach, DOZER.bladeHalf)], false);
      this.world.stroke({ color: 0xffe39a, width: stroke, alpha: .75 });
    }
    drawDebugOverlay(this.debugOverlay, town, dozer, view);
    this.drawLandmarkMarkers();
    this.fades.end();
    this.stats = { total, visible, commands: submitted.length, surfaceGeometry, cached: this.drawing.size, rebuilt: this.drawing.rebuilt };
  }

  private drawLandmarkMarkers(): void {
    this.landmarkPin.clear();
    this.landmarkArrow.clear();
    const target = this.landmarkTarget;
    if (!target || target.fullyDown) return;
    const cx = target.x + target.w * target.cellSize * 0.5;
    const cy = target.y + target.d * target.cellSize * 0.5;
    const top = target.floors * FLOOR_Z + 1.2;
    const peak = worldToScreen(cx, cy, top);
    this.landmarkPin.circle(peak.x, peak.y - 10, 7).fill({ color: 0xf0c14b, alpha: 0.95 });
    this.landmarkPin.circle(peak.x, peak.y - 10, 3).fill(0x1b211f);
    this.landmarkPin.moveTo(peak.x, peak.y - 3).lineTo(peak.x - 5, peak.y + 6).lineTo(peak.x + 5, peak.y + 6).fill({ color: 0xf0c14b, alpha: 0.95 });
    const screenX = peak.x * this.zoom - this.camX + this.viewW / 2;
    const screenY = peak.y * this.zoom - this.camY + this.viewH / 2;
    const pad = 36;
    const onScreen = screenX > pad && screenX < this.viewW - pad && screenY > pad && screenY < this.viewH - pad;
    if (onScreen) return;
    const x = Math.max(pad, Math.min(this.viewW - pad, screenX));
    const y = Math.max(pad, Math.min(this.viewH - 140, screenY));
    const angle = Math.atan2(screenY - y, screenX - x);
    this.landmarkArrow.position.set(x, y);
    this.landmarkArrow.rotation = angle;
    this.landmarkArrow.moveTo(12, 0).lineTo(-8, -7).lineTo(-8, 7).fill({ color: 0xf0c14b, alpha: 0.92 });
  }
}

function roofVerts(roof: RoofSection): { x: number; y: number; z: number }[] {
  return displacedRoofVerts(roof);
}

function chimneyWorld(b: Building): { x: number; y: number; z: number } | null {
  const live = b.roofs.some((r) => r.state === "intact" || r.state === "sagging");
  if (!live) return null;
  const cs = b.cellSize;
  const w = 0.32;
  const d = 0.32;
  const x = b.x + (b.w - 0.55) * cs;
  const y = b.y + 0.12;
  const samples = [
    roofHeightAt(b, x, y),
    roofHeightAt(b, x + w, y),
    roofHeightAt(b, x + w, y + d),
    roofHeightAt(b, x, y + d),
  ].filter((z): z is number => z != null);
  if (samples.length === 0) return null;
  return { x, y, z: Math.min(...samples) - 0.03 };
}

function drawChimney(g: Graphics, ch: { x: number; y: number; z: number }, alpha: number): void {
  drawIsoBox(g, ch.x, ch.y, 0.32, 0.32, ch.z, 0.85, PAL.brick, PAL.brickDark, PAL.brick, alpha);
}

function roofColors(b: Building, roof: RoofSection, verts: { x: number; y: number; z: number }[]): { top: number; edge: number } {
  if (roof.material === 'glass') return { top: PAL.glassLit, edge: PAL.glass };
  if (roof.material === "metal" || b.roof === "shed") return { top: PAL.roofMetal, edge: PAL.metalDark };
  if (b.roof === "flat") return { top: PAL.roofFelt, edge: PAL.metalDark };
  const lit = roofSlopeLight(verts);
  const top = lit >= 0 ? PAL.roofShingle : shade(PAL.roofShingle, 0.78);
  return { top, edge: PAL.roofShingleDark };
}

function ridgeKey(ridge: NonNullable<RoofSection["ridge"]>): string {
  return `${ridge.ax}:${ridge.ay}:${ridge.az}:${ridge.bx}:${ridge.by}:${ridge.bz}`;
}

function drawRoofBay(g: Graphics, b: Building, roof: RoofSection, alpha: number): void {
  const drawn = new Set<string>();
  drawRoofSection(g, b, roof, alpha, drawn, () => {
    if (roof.material === 'glass' || roofShowsFrame(b, roof)) {
      drawRoofFrame(g, b, roof, alpha * 0.92);
    }
  });
}

function drawRoofSection(
  g: Graphics,
  b: Building,
  roof: RoofSection,
  alpha: number,
  drawnRidges: Set<string>,
  beforeCover?: () => void,
): void {
  const raw = roofVerts(roof);
  const verts = applyBrokenRoofEdge(b, roof, raw);
  const cols = roofColors(b, roof, verts);
  const faded = (roof.state === "falling" ? alpha * 0.9 : alpha) * (roof.material === 'glass' ? .28 : 1);
  const thick = 0.14;
  for (const closure of sawtoothClosures(roof)) {
    drawWorldPoly(g, closure.verts, closure.glass ? PAL.glassLit : cols.edge, faded);
    if (closure.glass) {
      const [a, b0, c, d] = closure.verts;
      for (const t of [.25, .5, .75]) {
        const p = worldToScreen(a!.x + (b0!.x - a!.x) * t, a!.y + (b0!.y - a!.y) * t, a!.z + (b0!.z - a!.z) * t);
        const q = worldToScreen(d!.x + (c!.x - d!.x) * t, d!.y + (c!.y - d!.y) * t, d!.z + (c!.z - d!.z) * t);
        g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: PAL.frame, width: 1, alpha: faded });
      }
    }
  }
  if (!roof.bay) {
    const under = verts.map((v) => ({ x: v.x, y: v.y, z: v.z - thick }));
    drawSlopedQuad(g, under.slice().reverse(), cols.edge, cols.edge, faded * 0.95);
    for (let i = 0; i < verts.length; i++) {
      const n = (i + 1) % verts.length;
      drawSlopedQuad(
        g,
        [verts[i]!, verts[n]!, under[n]!, under[i]!],
        cols.edge,
        cols.edge,
        faded,
      );
    }
  }
  if (!roof.bay) beforeCover?.();
  if (roof.bay && verts.length === 4) {
    // Shrinking the torn covering slightly reveals the short steel members underneath.
    const cx = verts.reduce((s, v) => s + v.x, 0) / 4;
    const cy = verts.reduce((s, v) => s + v.y, 0) / 4;
    const exposed = roofShowsFrame(b, roof);
    const inset = exposed ? .055 * (1 - roof.fallT) : 0;
    const cover = verts.map(v => ({ ...v, x: v.x + (cx - v.x) * inset, y: v.y + (cy - v.y) * inset }));
    const [a, b0, c, d] = cover as [typeof verts[number], typeof verts[number], typeof verts[number], typeof verts[number]];
    const buckle = (roof.sag * .22 + Math.sin(roof.fallT * Math.PI) * .18) * (1 - roof.fallT);
    const mid = (p: typeof a, q: typeof a) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: Math.max(.16, (p.z + q.z) / 2 - buckle) });
    const ab = mid(a, b0), dc = mid(d, c);
    // Give each folded half its own underside, rather than a rigid slab across the crease.
    for (const face of [[a, ab, dc, d], [ab, b0, c, dc]]) {
      const under = face.map(v => ({ ...v, z: v.z - thick }));
      drawSlopedQuad(g, under.slice().reverse(), cols.edge, cols.edge, faded);
      for (let i = 0; i < face.length; i++) {
        const n = (i + 1) % face.length;
        drawSlopedQuad(g, [face[i]!, face[n]!, under[n]!, under[i]!], cols.edge, cols.edge, faded);
      }
    }
    beforeCover?.();
    drawSlopedQuad(g, [a, ab, dc, d], cols.top, cols.top, faded);
    drawSlopedQuad(g, [ab, b0, c, dc], shade(cols.top, 1 - buckle * .2), cols.top, faded);
    const p = worldToScreen(ab.x, ab.y, ab.z), q = worldToScreen(dc.x, dc.y, dc.z);
    g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: cols.edge, width: .6, alpha: faded * .25 });
  } else drawSlopedQuad(g, verts, cols.top, cols.edge, faded);
  if (roof.ridge && roof.state !== "falling" && sectionOwnsRidge(b, roof)) {
    const key = ridgeKey(roof.ridge);
    if (!drawnRidges.has(key)) {
      drawnRidges.add(key);
      const r = roof.ridge;
      const sag = roof.sag * 0.35;
      drawSlopedQuad(
        g,
        [
          { x: r.ax, y: r.ay, z: r.az + 0.05 - sag },
          { x: r.bx, y: r.by, z: r.bz + 0.05 - sag },
          { x: r.bx, y: r.by, z: r.bz - 0.02 - sag },
          { x: r.ax, y: r.ay, z: r.az - 0.02 - sag },
        ],
        cols.edge,
        cols.edge,
        faded,
      );
    }
  }
  if (b.features.parapet && roof.style === "flat" && roof.state === "intact") {
    const z = verts[0]!.z;
    const xs = verts.map((v) => v.x);
    const ys = verts.map((v) => v.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    drawIsoBox(g, x0, y0, x1 - x0, 0.08, z, 0.22, PAL.concrete, PAL.concreteDark, PAL.concrete, faded);
    drawIsoBox(g, x0, y1 - 0.08, x1 - x0, 0.08, z, 0.22, PAL.concrete, PAL.concreteDark, PAL.concrete, faded);
  }
}

function drawCollapsedSite(g: Graphics, site: CollapsedSite): void {
  const rng = new Rng(site.seed);
  drawGroundPoly(g, site.x + 0.04, site.y + 0.04, site.w - 0.08, site.d - 0.08, PAL.lotDark, 0.28);
  for (const mark of site.marks) {
    const color =
      mark.kind === "dirt"
        ? PAL.lotDark
        : mark.kind === "slab"
          ? PAL.concrete
          : mark.kind === "crack"
            ? PAL.crack
            : mark.kind === "outline"
              ? PAL.foundation
              : mark.kind === "ridge"
                ? PAL.concreteDark
                : PAL.brickDark;
    const alpha =
      mark.kind === "crack" ? 0.55 : mark.kind === "dirt" ? 0.4 : mark.kind === "outline" ? 0.7 : 0.62;
    if (mark.kind === "ridge" || mark.kind === "remnant") {
      drawIsoBox(g, mark.x, mark.y, mark.w, mark.d, 0, mark.z, color, PAL.concreteDark, color, alpha);
    } else {
      drawGroundPoly(g, mark.x, mark.y, mark.w, mark.d, color, alpha);
    }
  }
  void rng;
}

function drawCover(g: Graphics, patch: GroundPatch): void {
  const color = coverColor(patch.cover);
  if (patch.poly && patch.poly.length >= 3) {
    drawWorldPoly(g, patch.poly.map((p) => ({ x: p.x, y: p.y, z: patch.z })), color, 1);
  } else if (Math.abs(patch.heading) > 0.05) {
    drawOrientedGround(g, patch.x + patch.w * 0.5, patch.y + patch.d * 0.5, patch.heading, patch.w, patch.d, color, 1, patch.z);
  } else {
    drawGroundPoly(g, patch.x, patch.y, patch.w, patch.d, color, 1, patch.z);
  }
  if (patch.cover === "water" || patch.cover === "forest-floor" || patch.cover.startsWith("field-")) {
    if (patch.cover.startsWith("field-")) drawFieldRows(g, patch);
    return;
  }
  const speckle = patch.z < 0 ? 1 : Math.min(40, Math.max(4, Math.floor((patch.w * patch.d) / 18)));
  const dark = coverDark(patch.cover);
  for (let i = 0; i < speckle; i++) {
    const gx = patch.x + ((i * 17 + (patch.seed % 13)) % 97) * 0.12 * (patch.w / 8);
    const gy = patch.y + ((i * 29 + (patch.seed % 17)) % 89) * 0.1 * (patch.d / 8);
    if (gx > patch.x + patch.w || gy > patch.y + patch.d) continue;
    drawGroundPoly(g, gx, gy, 0.32, 0.26, dark, 0.2, patch.z);
  }
}

function drawFieldRows(g: Graphics, patch: GroundPatch): void {
  const gap = patch.cover === "field-mature" ? 0.7 : 0.52;
  const rows = Math.min(16, Math.max(5, Math.floor(patch.d / gap)));
  const color = coverDark(patch.cover);
  const thick = patch.cover === "field-tilled" ? 0.22 : patch.cover === "field-stubble" ? 0.16 : patch.cover === "field-mature" ? 0.28 : 0.2;
  const z = patch.z + 0.006;
  for (let i = 0; i < rows; i++) {
    const t = (i + 0.5) / rows - 0.5;
    const fx = Math.cos(patch.heading);
    const fy = Math.sin(patch.heading);
    const cx = patch.x + patch.w * 0.5 - fy * t * patch.d;
    const cy = patch.y + patch.d * 0.5 + fx * t * patch.d;
    drawOrientedGround(g, cx, cy, patch.heading, patch.w * 0.9, thick, color, patch.cover === "field-tilled" ? 0.7 : 0.95, z);
  }
}

function drawTerrainFeatures(g: Graphics, features: readonly TerrainFeature[]): void {
  for (const feature of features) {
    switch (feature.kind) {
      case "forest":
        drawForestCanopy(g, feature);
        break;
      case "field":
        drawFieldCrops(g, feature);
        drawFieldChurn(g, feature);
        break;
      case "pond":
      case "lake":
      case "river":
        break;
      default: {
        const _never: never = feature;
        return _never;
      }
    }
  }
}

function drawForestCanopy(g: Graphics, feature: Extract<TerrainFeature, { kind: "forest" }>): void {
  const rng = new Rng(feature.seed);
  const blobs = 6;
  for (let i = 0; i < blobs; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(feature.coreR * 0.55, feature.canopyR * 0.82);
    const w = rng.range(2.2, 3.4);
    const d = rng.range(1.9, 2.9);
    drawOrientedGround(
      g,
      feature.cx + Math.cos(a) * r,
      feature.cy + Math.sin(a) * r,
      a,
      w,
      d,
      i % 2 === 0 ? 0x3a5a30 : 0x2c4826,
      0.55,
      0.018,
    );
  }
  drawOrientedGround(g, feature.cx, feature.cy, 0, feature.coreR * 1.65, feature.coreR * 1.5, 0x0c1810, 0.96, 0.028);
}

function cropRowStyle(feature: FieldFeature): { top: number; left: number; right: number; h: number; thick: number } {
  const mature = feature.state === "mature";
  const short = feature.state === "short";
  switch (feature.crop) {
    case "corn":
      return {
        top: mature ? 0xd4c44a : short ? 0x6aaa38 : 0x8a6a38,
        left: mature ? 0x6a7a22 : 0x3a4a1c,
        right: mature ? 0x8a9a2c : 0x4a5a22,
        h: mature ? 0.48 : short ? 0.18 : 0.05,
        thick: mature ? 0.26 : 0.2,
      };
    case "wheat":
      return {
        top: mature ? 0xe2c456 : short ? 0x8aaa40 : 0x9a7a40,
        left: mature ? 0x8a6a22 : 0x4a4a1c,
        right: mature ? 0xb08a30 : 0x5a5a22,
        h: mature ? 0.32 : short ? 0.14 : 0.05,
        thick: mature ? 0.24 : 0.18,
      };
    case "soy":
      return {
        top: mature ? 0x4a8a38 : short ? 0x5a9a42 : 0x7a5a30,
        left: mature ? 0x245022 : 0x3a3818,
        right: mature ? 0x366a2c : 0x4a4820,
        h: mature ? 0.28 : short ? 0.12 : 0.05,
        thick: mature ? 0.28 : 0.2,
      };
    default: {
      const _never: never = feature.crop;
      return _never;
    }
  }
}

function drawFieldCrops(g: Graphics, feature: FieldFeature): void {
  if (feature.state === "tilled") return;
  const style = cropRowStyle(feature);
  const gap = 0.62;
  const rows = Math.min(14, Math.max(5, Math.floor(feature.d / gap)));
  const fx = Math.cos(feature.heading);
  const fy = Math.sin(feature.heading);
  const ox = feature.x + feature.w * 0.5;
  const oy = feature.y + feature.d * 0.5;
  for (let i = 0; i < rows; i++) {
    const t = (i + 0.5) / rows - 0.5;
    const cx = ox - fy * t * feature.d;
    const cy = oy + fx * t * feature.d;
    drawOrientedIsoBox(
      g,
      cx,
      cy,
      feature.heading,
      feature.w * 0.88,
      style.thick,
      0.012,
      style.h,
      style.top,
      style.left,
      style.right,
      feature.state === "stubble" ? 0.7 : 1,
    );
  }
}

function drawFieldChurn(g: Graphics, feature: FieldFeature): void {
  const fx = Math.cos(feature.heading);
  const fy = Math.sin(feature.heading);
  const ox = feature.x + feature.w * 0.5;
  const oy = feature.y + feature.d * 0.5;
  for (let iy = 0; iy < feature.rows; iy++) {
    for (let ix = 0; ix < feature.cols; ix++) {
      if (!feature.churn[iy * feature.cols + ix]) continue;
      const cx = ox + fx * ((ix + 0.5) * feature.cell - feature.w * 0.5) - fy * ((iy + 0.5) * feature.cell - feature.d * 0.5);
      const cy = oy + fy * ((ix + 0.5) * feature.cell - feature.w * 0.5) + fx * ((iy + 0.5) * feature.cell - feature.d * 0.5);
      drawOrientedIsoBox(
        g,
        cx,
        cy,
        feature.heading,
        feature.cell * 1.15,
        feature.cell * 1.15,
        0.01,
        0.06,
        0x6a4a28,
        0x3a2814,
        0x52381c,
        1,
      );
    }
  }
}

function coverColor(cover: CoverKind): number {
  switch (cover) {
    case "grass":
      return PAL.grass;
    case "scrub":
      return PAL.grassDark;
    case "dirt":
      return PAL.dirt;
    case "gravel":
      return PAL.gravel;
    case "tracks":
      return PAL.lotDark;
    case "concrete":
    case "parking":
      return PAL.concrete;
    case "driveway":
      return 0x5a5248;
    case "planted":
      return PAL.planted;
    case "lot":
      return PAL.lot;
    case "water":
      return PAL.water;
    case "forest-floor":
      return PAL.forestFloor;
    case "field-tilled":
      return PAL.fieldTilled;
    case "field-short":
      return PAL.fieldShort;
    case "field-mature":
      return PAL.fieldMature;
    case "field-stubble":
      return PAL.fieldStubble;
    default: {
      const _never: never = cover;
      return _never;
    }
  }
}

function coverDark(cover: CoverKind): number {
  switch (cover) {
    case "grass":
    case "scrub":
    case "planted":
      return PAL.grassDark;
    case "dirt":
    case "tracks":
    case "lot":
      return PAL.lotDark;
    case "gravel":
    case "driveway":
      return 0x5a5448;
    case "concrete":
    case "parking":
      return PAL.concreteDark;
    case "water":
      return PAL.waterDark;
    case "forest-floor":
    case "field-short":
    case "field-mature":
      return 0x1e381c;
    case "field-tilled":
    case "field-stubble":
      return 0x5a3a1c;
    default: {
      const _never: never = cover;
      return _never;
    }
  }
}

function drawParticle(g: Graphics, p: Particle): void {
  const fade = Math.min(1, p.life / p.maxLife);
  const s = worldToScreen(p.x, p.y, 0);
  g.ellipse(s.x, s.y, 3.2, 1.6);
  g.fill({ color: PAL.shadow, alpha: 0.2 * fade });
  if (p.kind === "dust") {
    const c = worldToScreen(p.x, p.y, p.z);
    const r = 5 + p.size * 10;
    g.rect(c.x - r / 2, c.y - r / 2, r, r);
    g.fill({ color: PAL.dust, alpha: 0.32 * fade });
    return;
  }
  const color =
    p.kind === "wood"
      ? PAL.wood
      : p.kind === "brick"
        ? PAL.brick
        : p.kind === "metal"
          ? PAL.metal
          : p.kind === "glass"
            ? 0xa8c4d0
            : PAL.concrete;
  const dark =
    p.kind === "wood"
      ? PAL.woodDark
      : p.kind === "brick"
        ? PAL.brickDark
        : p.kind === "metal"
          ? PAL.metalDark
          : PAL.concreteDark;
  const len = p.kind === "wood" ? 0.18 + p.size * 0.35 : 0.1 + p.size * 0.22;
  const wid = p.kind === "wood" ? 0.05 + p.size * 0.08 : 0.07 + p.size * 0.12;
  drawOrientedIsoBox(g, p.x, p.y, p.rot, len, wid, p.z, Math.max(0.04, p.size * 0.2), color, dark, color, 0.92 * fade);
}

function drawGroundMark(g: Graphics, mark: GroundMark): void {
  const color =
    mark.kind === "scrape"
      ? 0x2a2418
      : mark.kind === "dust"
        ? PAL.lotDark
        : mark.kind === "glass"
          ? 0x8aa4b0
          : mark.material === "wood"
            ? PAL.woodDark
            : mark.material === "brick"
              ? PAL.brickDark
              : mark.material === "metal"
                ? PAL.metalDark
                : PAL.concreteDark;
  const fx = Math.cos(mark.heading);
  const fy = Math.sin(mark.heading);
  const hx = mark.w * 0.5;
  const hy = mark.d * 0.5;
  const pts = [
    { x: mark.x + fx * hx - fy * hy, y: mark.y + fy * hx + fx * hy },
    { x: mark.x + fx * hx + fy * hy, y: mark.y + fy * hx - fx * hy },
    { x: mark.x - fx * hx + fy * hy, y: mark.y - fy * hx - fx * hy },
    { x: mark.x - fx * hx - fy * hy, y: mark.y - fy * hx + fx * hy },
  ];
  const q = pts.flatMap((p) => {
    const s = worldToScreen(p.x, p.y, 0);
    return [s.x, s.y];
  });
  g.poly(q);
  g.fill({ color, alpha: mark.alpha });
}

function drawPileHints(
  g: Graphics,
  town: Town,
  visible: (x: number, y: number, w: number, d: number) => boolean,
): void {
  const pile = town.pile;
  const coreAreas = corePileAreas(town).filter(a => visible(a.x, a.y, a.w, a.d));
  drawCorePiles(g, town, coreAreas);
  for (let iy = 0; iy < pile.rows; iy++) {
    for (let ix = 0; ix < pile.cols; ix++) {
      const i = iy * pile.cols + ix;
      const h = pile.height[i]!;
      if (h < 0.05) continue;
      const x = pile.ox + (ix + 0.12) * pile.cell;
      const y = pile.oy + (iy + 0.12) * pile.cell;
      if (coreAreas.some(a => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.d)) continue;
      const s = pile.cell * 0.76;
      if (!visible(x, y, s, s)) continue;
      const alpha = Math.min(0.62, 0.16 + h * 0.85);
      drawGroundPoly(g, x, y, s, s, PAL.lotDark, alpha);
      if (h > 0.14) {
        drawIsoBox(g, x + 0.04, y + 0.04, s * 0.72, s * 0.72, 0, Math.min(.42, h * .55), PAL.concrete, PAL.concreteDark, PAL.concrete, Math.min(0.85, 0.35 + h));
      }
    }
  }
}

function drawDebris(g: Graphics, r: Rubble): void {
  const rng = new Rng(r.seed);
  const cols = cellColors(r.material, true);
  const z0 = r.elev;
  const h = Math.max(0.05, r.thickness);
  drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w * 1.08, r.d * 1.08, 0, 0.02, PAL.shadow, PAL.shadow, PAL.shadow, 0.26);

  if (r.skin === "roofing") {
    const metal = r.material === "metal";
    const top = metal ? PAL.roofMetal : PAL.roofShingle;
    const edge = metal ? PAL.metalDark : PAL.roofShingleDark;
    const under = metal ? PAL.metalDark : PAL.wood;
    const underDark = metal ? PAL.metal : PAL.woodDark;
    drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w, r.d, z0, Math.max(0.04, h * 0.45), under, underDark, under, 0.95);
    drawOrientedIsoBox(
      g,
      r.x,
      r.y,
      r.heading,
      r.w * 0.9,
      r.d * 0.86,
      z0 + h * 0.28,
      Math.max(0.05, h * 0.72),
      top,
      edge,
      edge,
      1,
    );
    if (!metal && rng.next() > 0.55) {
      const fold = rng.range(-0.18, 0.18);
      drawOrientedIsoBox(
        g,
        r.x + Math.cos(r.heading) * r.w * 0.28,
        r.y + Math.sin(r.heading) * r.w * 0.28,
        r.heading + fold,
        r.w * 0.26,
        r.d * 0.2,
        z0 + h * 0.55,
        h * 0.28,
        PAL.roofShingleDark,
        PAL.woodDark,
        PAL.roofShingle,
        1,
      );
    }
    return;
  }

  if (r.shape === "beam") {
    drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w, r.d, z0, h, cols.top, cols.left, cols.right, 1);
    if (rng.next() > 0.4) {
      const t = rng.range(-0.22, 0.22);
      const fx = Math.cos(r.heading);
      const fy = Math.sin(r.heading);
      drawOrientedIsoBox(
        g,
        r.x + fx * t * r.w,
        r.y + fy * t * r.w,
        r.heading + rng.range(-0.25, 0.25),
        r.w * 0.35,
        r.d * 0.7,
        z0 + h * 0.15,
        h * 0.45,
        cols.top,
        cols.left,
        cols.right,
        1,
      );
    }
    return;
  }

  if (r.shape === "panel") {
    const fold = rng.range(-0.35, 0.35);
    const fx = Math.cos(r.heading);
    const fy = Math.sin(r.heading);
    const rx = -fy;
    const ry = fx;
    drawOrientedIsoBox(g, r.x + rx * r.d * 0.18, r.y + ry * r.d * 0.18, r.heading + fold, r.w * 0.72, r.d * 0.7, z0, h, cols.top, cols.left, cols.right, 1);
    drawOrientedIsoBox(g, r.x - rx * r.d * 0.16, r.y - ry * r.d * 0.16, r.heading - fold * 0.8, r.w * 0.55, r.d * 0.55, z0 + h * 0.2, h * 0.7, cols.top, cols.left, cols.right, 0.95);
    return;
  }

  drawOrientedIsoBox(g, r.x, r.y, r.heading, r.w, r.d, z0, h, cols.top, cols.left, cols.right, 1);
  if (r.layer === "remnant" && rng.next() > 0.35) {
    const ox = rng.range(-0.18, 0.18);
    const oy = rng.range(-0.18, 0.18);
    drawOrientedIsoBox(
      g,
      r.x + ox,
      r.y + oy,
      r.heading + rng.range(-0.4, 0.4),
      r.w * rng.range(0.4, 0.65),
      r.d * rng.range(0.35, 0.6),
      z0 + h * 0.25,
      h * rng.range(0.35, 0.7),
      cols.top,
      cols.left,
      cols.right,
      1,
    );
  }
}

function drawBird(g: Graphics, bird: Bird): void {
  const c = worldToScreen(bird.x, bird.y, bird.z);
  g.poly([c.x, c.y, c.x + 6, c.y - 2, c.x + 2, c.y + 1]);
  g.fill({ color: PAL.bird, alpha: Math.min(1, bird.life) });
}
