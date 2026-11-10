import { CAPITOL_COUNTY_INDEX, COUNTIES_PER_REGION, countyId } from '../world/counties';
import type { SessionKind } from './session';

/**
 * Time Challenge county completions, kept per browser. Sandbox never reads or writes it.
 * Storage can be missing or throw (private windows, blocked site data); progress then lives
 * only in memory for this page.
 */
const STORAGE_KEY = 'permit-denied.county-progress.v1';

export interface ProgressStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): ProgressStore | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

let shared: CountyProgress | undefined;

/**
 * The page's one progress record. The game writes clears and the map reads them through this
 * instance, so a clear survives map navigation even when storage is blocked or a write fails.
 */
export function sharedCountyProgress(): CountyProgress {
  shared ??= new CountyProgress();
  return shared;
}

/** Tests only: drop the shared record so the next call reloads from storage. */
export function resetSharedCountyProgress(store?: ProgressStore): CountyProgress {
  shared = new CountyProgress(store);
  return shared;
}

export class CountyProgress {
  private readonly cleared = new Set<string>();

  constructor(private readonly store: ProgressStore | undefined = defaultStore()) {
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(this.store?.getItem(STORAGE_KEY) ?? 'null') as { cleared?: unknown } | null;
      if (Array.isArray(parsed?.cleared)) for (const id of parsed.cleared) if (typeof id === 'string') this.cleared.add(id);
    } catch {
      // Corrupt or unreadable progress starts clean rather than blocking the menu.
    }
  }

  private save(): void {
    try {
      this.store?.setItem(STORAGE_KEY, JSON.stringify({ cleared: [...this.cleared].sort() }));
    } catch {
      // Quota or blocked storage: keep the in-memory record for this session.
    }
  }

  isCleared(regionId: string, index: number): boolean {
    return this.cleared.has(countyId(regionId, index));
  }

  markCleared(regionId: string, index: number): void {
    const id = countyId(regionId, index);
    if (this.cleared.has(id)) return;
    this.cleared.add(id);
    this.save();
  }

  /** Every county cleared in this browser, across all regions. */
  totalCleared(): number {
    return this.cleared.size;
  }

  clearedCount(regionId: string): number {
    let count = 0;
    for (let index = 1; index <= COUNTIES_PER_REGION; index++) if (this.isCleared(regionId, index)) count++;
    return count;
  }

  /** Sandbox opens everything. Time Challenge opens 1–6; the capitol opens once all six are cleared. */
  isUnlocked(kind: SessionKind, regionId: string, index: number): boolean {
    if (kind === 'sandbox') return true;
    if (index !== CAPITOL_COUNTY_INDEX) return index >= 1 && index < CAPITOL_COUNTY_INDEX;
    for (let other = 1; other < CAPITOL_COUNTY_INDEX; other++) if (!this.isCleared(regionId, other)) return false;
    return true;
  }

  /**
   * Where Next Level goes after clearing `from`: the next uncleared county after it (wrapping
   * through 1–6), then the capitol once it unlocks. Null when the capitol itself was cleared.
   */
  nextChallengeCounty(regionId: string, from: number): number | null {
    if (from >= CAPITOL_COUNTY_INDEX) return null;
    for (let step = 1; step < CAPITOL_COUNTY_INDEX; step++) {
      const index = ((from - 1 + step) % (CAPITOL_COUNTY_INDEX - 1)) + 1;
      if (!this.isCleared(regionId, index)) return index;
    }
    return CAPITOL_COUNTY_INDEX;
  }
}
