export type OverworldModule = typeof import('./overworld');

let pending: Promise<OverworldModule> | undefined;

/** One shared lazy load of the overworld chunk; later calls reuse the same promise. */
export function loadOverworld(): Promise<OverworldModule> {
  pending ??= import('./overworld');
  return pending;
}
