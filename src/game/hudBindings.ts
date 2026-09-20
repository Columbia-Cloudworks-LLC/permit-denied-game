import type { Hud } from "../render/hud";
import type { PermitSound } from "../render/permitIntro";
import type { DebugToggle } from "../debug/view";
import type { DistrictId, SessionKind } from "./session";

/** HUD callbacks owned by session setup, not by the HUD template. */
export interface HudSessionBindings {
  onMute: () => void;
  onClick: () => void;
  onUnlockSound: () => Promise<void>;
  onResubmit: () => number | null;
  onTitleSound: (kind: PermitSound, index: number) => void;
  onMenu: () => void;
  onTitle: () => void;
  onStart: (kind: SessionKind, district: DistrictId) => void;
  onBeginLevel: () => void;
  onNextLevel: () => void;
  onRetryLevel: () => void;
  onNewCampaign: () => void;
  onTestYard: () => void;
  onResetTest: () => void;
  onChoice: (id: "blade" | "engine" | "push") => void;
  onResume: () => void;
  onRestart: () => void;
  onNewSeed: () => void;
  onSession: (kind: SessionKind) => void;
  onDistrict: (id: DistrictId) => void;
  onJob: () => void;
  onDebugOpen: () => void;
  onDebugToggle: (key: DebugToggle, value: boolean) => void;
  onDebugFloor: (floor: number) => void;
  onDebugReset: () => void;
  onDebugStep: () => void;
}

export function bindHudSession(hud: Hud, bindings: HudSessionBindings): void {
  hud.onMute = bindings.onMute;
  hud.onClick = bindings.onClick;
  hud.onUnlockSound = bindings.onUnlockSound;
  hud.onResubmit = bindings.onResubmit;
  hud.onTitleSound = bindings.onTitleSound;
  hud.onMenu = bindings.onMenu;
  hud.onTitle = bindings.onTitle;
  hud.onStart = bindings.onStart;
  hud.onBeginLevel = bindings.onBeginLevel;
  hud.onNextLevel = bindings.onNextLevel;
  hud.onRetryLevel = bindings.onRetryLevel;
  hud.onNewCampaign = bindings.onNewCampaign;
  hud.onTestYard = bindings.onTestYard;
  hud.onResetTest = bindings.onResetTest;
  hud.onChoice = bindings.onChoice;
  hud.onResume = bindings.onResume;
  hud.onRestart = bindings.onRestart;
  hud.onNewSeed = bindings.onNewSeed;
  hud.onSession = bindings.onSession;
  hud.onDistrict = bindings.onDistrict;
  hud.onJob = bindings.onJob;
  hud.onDebugOpen = bindings.onDebugOpen;
  hud.onDebugToggle = bindings.onDebugToggle;
  hud.onDebugFloor = bindings.onDebugFloor;
  hud.onDebugReset = bindings.onDebugReset;
  hud.onDebugStep = bindings.onDebugStep;
}
