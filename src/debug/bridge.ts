import type { DebugBinderState } from "./binderState";
import type { DebugView } from "./view";
import type { CampaignLevelId } from "../game/campaign";
import type { DistrictId, PlayMode, SessionKind } from "../game/session";
import type { TestMapRequest } from "../world/testMapRequest";
import type { TerrainFeature } from "../world/terrainFeatures";

export const DEBUG_BRIDGE_VERSION = 1 as const;

export interface GameSnapshot {
  cash: number;
  timeLeft: number;
  elapsed: number;
  mode: PlayMode;
  session: SessionKind;
  district: DistrictId;
  seed: number;
  dozer: { x: number; y: number; heading: number };
  rubble: number;
  marks: number;
  roadCar: { x: number; y: number } | null;
  buildings: { name: string; states: Record<string, number> }[];
}

export interface DozerPose {
  x: number;
  y: number;
  heading: number;
  bladeDown: boolean;
  vx: number;
  motionStartX?: number;
  motionStartY?: number;
}

export interface CameraSnapshot {
  x: number;
  y: number;
  zoom: number;
}

export interface TownLotSnapshot {
  id: string;
  identity: string;
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface TownGroundSnapshot {
  cover: string;
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface TownPropSnapshot {
  assetId: string;
  x: number;
  y: number;
  w: number;
  d: number;
  broken: boolean;
}

export interface TownFeatureSnapshot {
  kind: string;
  x?: number;
  y?: number;
  w?: number;
  d?: number;
  heading?: number;
  crop?: string;
  state?: string;
  cx?: number;
  cy?: number;
  coreR?: number;
  canopyR?: number;
  path?: { x: number; y: number }[];
  halfWidth?: number;
  poly?: { x: number; y: number }[];
}

export interface TownDebugSnapshot {
  groundCondition: string;
  biomeId: string;
  spawn: { x: number; y: number };
  lots: TownLotSnapshot[];
  ground: TownGroundSnapshot[];
  features: TownFeatureSnapshot[];
  props: TownPropSnapshot[];
  rubble: number;
  yardIssues: number;
  bays: number;
  vehicles: { autonomous: boolean; status?: string; damage: number }[];
  following: boolean;
}

export interface BinderInspectSnapshot {
  mode: PlayMode;
  seed: number;
  request: TestMapRequest | undefined;
  upgrades: { blade: number; engine: number; push: number };
  binder: DebugBinderState;
  debug: DebugView;
  dozer: { x: number; y: number };
  spawn: { x: number; y: number };
  elapsed: number;
  bays: number;
  vehicles: number;
  following: boolean;
  status?: string;
  damage: number;
  rubble: number;
  job: boolean;
  yardIssues: number;
}

export interface YardInspectSnapshot {
  followRoadCamera: boolean;
  loads: number;
  autonomousCount: number;
  vehicles: { definitionId: string; autonomous: boolean; status: string; damaged: boolean }[];
}

export interface VehiclePerfReport {
  vehicles: number;
  simP95Ms: number;
  renderSubmitP95Ms: number;
  stats: Record<string, number>;
  renderStats: Record<string, number>;
}

export interface DebugBridge {
  readonly version: typeof DEBUG_BRIDGE_VERSION;
  ready(): boolean;
  snapshot(): GameSnapshot;
  inspect(): BinderInspectSnapshot;
  townSnapshot(): TownDebugSnapshot;
  dozerSnapshot(): DozerPose;
  cameraSnapshot(): CameraSnapshot;
  yardInspect(): YardInspectSnapshot;
  urbanSnapshot(): Record<string, unknown> | undefined;
  obstructionAt(x: number, y: number, radius?: number): { blocked: boolean; height: number; resistance: number };
  lookAtWorld(x: number, y: number, heading?: number, zoom?: number): void;
  frameDozer(zoom?: number): void;
  lookAtTown(mode?: "overview" | "street" | "open"): void;
  step(dt: number): void;
  reset(kind?: "same" | "new"): void;
  setDozerPose(pose: Partial<DozerPose>): void;
  spawnRoadVehicle(): void;
  jumpCampaignLevel(id: CampaignLevelId): void;
  analyticsStep(seconds: number, mode: string, district: string): void;
  finish(death: string, won: boolean): void;
  inputAxis(): { throttle: number; steer: number };
  runVehiclePerfHarness(): Promise<VehiclePerfReport>;
}

export function serializeTownFeature(feature: TerrainFeature): TownFeatureSnapshot {
  switch (feature.kind) {
    case "field":
      return {
        kind: feature.kind,
        x: feature.x,
        y: feature.y,
        w: feature.w,
        d: feature.d,
        heading: feature.heading,
        crop: feature.crop,
        state: feature.state,
      };
    case "forest":
      return {
        kind: feature.kind,
        cx: feature.cx,
        cy: feature.cy,
        coreR: feature.coreR,
        canopyR: feature.canopyR,
      };
    case "river":
      return { kind: feature.kind, path: feature.path, halfWidth: feature.halfWidth };
    case "pond":
    case "lake":
      return { kind: feature.kind, poly: feature.poly };
    default: {
      const exhaustive: never = feature;
      throw new Error(`unhandled terrain feature ${(exhaustive as { kind: string }).kind}`);
    }
  }
}

export type DebugHost = Omit<DebugBridge, "version">;

const DEBUG_QUERY_KEYS = [
  "debug",
  "yard",
  "testAsset",
  "tower",
  "demo",
  "job",
  "ranch",
  "perf",
  "nhood",
] as const;

export function shouldInstallDebugBridge(search: string, isDev: boolean): boolean {
  if (isDev) return true;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return DEBUG_QUERY_KEYS.some((key) => params.has(key));
}

export function createDebugBridge(host: DebugHost): DebugBridge {
  return Object.freeze({ version: DEBUG_BRIDGE_VERSION, ...host });
}

export function exposeDebugBridge(bridge: DebugBridge): void {
  Object.defineProperty(window, "__pd", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: bridge,
  });
}

export function clearDebugBridge(): void {
  delete (window as Window & { __pd?: DebugBridge }).__pd;
}

declare global {
  interface Window {
    __pd?: DebugBridge;
  }
}
