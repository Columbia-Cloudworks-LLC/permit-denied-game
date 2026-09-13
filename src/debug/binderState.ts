export type BinderTab = 'assets' | 'inspector' | 'session';

/** Owned by the HUD, never by a Town. No browser storage or runtime object references. */
export interface DebugBinderState {
  open: boolean;
  collapsed: boolean;
  tab: BinderTab;
  search: string;
  category: string;
  material: string;
  profile: string;
  assetId: string;
  variant: number;
  instanceKey?: string;
  expanded: Record<string, boolean>;
  scroll: Record<BinderTab, number>;
}

export function createDebugBinderState(): DebugBinderState {
  return { open: false, collapsed: false, tab: 'assets', search: '', category: '', material: '', profile: '',
    assetId: '', variant: 0, expanded: {}, scroll: { assets: 0, inspector: 0, session: 0 } };
}
