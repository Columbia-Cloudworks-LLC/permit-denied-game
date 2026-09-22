import { CAMPAIGN_LEVELS, type CampaignLevelId } from "./campaign";
import { MENU_LABELS as L, MODE_LABELS } from "./menuLabels";
import type { DistrictId, SessionKind } from "./session";

export interface DebugSessionView {
  testMapName?: string;
  job?: boolean;
  session: SessionKind;
  district: DistrictId;
  levelId?: CampaignLevelId;
  levelIndex?: number;
  levelName?: string;
  seed?: number;
  buildingCount?: number;
  landmarkName?: string;
  dollarTarget?: number;
  timeLimit?: number;
}

export function debugMapLabel(view: DebugSessionView): string {
  if (view.testMapName) return view.testMapName;
  if (view.job) return L.brick;
  if (view.session === "challenge" && view.levelName && view.levelIndex) {
    return `${MODE_LABELS.challenge} · ${view.levelIndex}/7 ${view.levelName}`;
  }
  if (view.levelName) return `${MODE_LABELS.sandbox} · ${view.levelName}`;
  return `${MODE_LABELS[view.session]} · ${view.district}`;
}

/** Sandbox sizes and the brick objective stay off during Time Challenge and the asset yard. */
export function debugSessionPanels(view: DebugSessionView): {
  levels: boolean;
  job: boolean;
  upgrades: boolean;
} {
  if (view.testMapName) return { levels: false, job: false, upgrades: false };
  if (view.session === "challenge") return { levels: true, job: false, upgrades: false };
  return { levels: true, job: true, upgrades: true };
}

export function debugSessionFacts(view: DebugSessionView): string {
  if (!view.levelName || view.testMapName) return "";
  const count = view.buildingCount ?? 0;
  const seed = view.seed ?? 0;
  if (view.session === "challenge") {
    const target = (view.dollarTarget ?? 0).toLocaleString("en-US");
    return `${count} buildings · seed ${seed} · ${view.landmarkName ?? "landmark"} · target $${target} · ${view.timeLimit ?? 0}s county clock`;
  }
  return `${count} buildings · seed ${seed} · no county clock or breakdowns`;
}

export function campaignLevelButtons(): { id: CampaignLevelId; label: string }[] {
  return CAMPAIGN_LEVELS.map((level) => ({ id: level.id, label: `${level.index}/7 ${level.name}` }));
}
