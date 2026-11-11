/**
 * Regional landmark packages. They live outside `src/world/data/`, so they stay out of the eager
 * `buildings` chunk and the startup budget: this module rides in the lazy overworld chunk and
 * registers its archetypes when it loads. County towns are only built after that chunk is in
 * (`Game.regionalPlacement`), so a regional landmark is always known before generation needs it.
 * Never import this from the startup graph.
 */
import { BUILDING_FILES, parseBuildingPackages, parseContentFiles, registerArchetypes, type Archetype } from './archetypes';

const LANDMARK_FILES = parseContentFiles(import.meta.glob<string>(
  ['./landmarkData/**/*.building.json', './landmarkData/**/*.layout.json'],
  { eager: true, query: '?raw', import: 'default' },
));

/** Landmark packages reuse the shared constructions; only those ride along into the parse. */
const SHARED_CONSTRUCTIONS = Object.fromEntries(Object.entries(BUILDING_FILES).filter(([file]) => file.endsWith('.construction.json')));

export const LANDMARK_ARCHETYPES: readonly Archetype[] = parseBuildingPackages({ ...SHARED_CONSTRUCTIONS, ...LANDMARK_FILES });

registerArchetypes(LANDMARK_ARCHETYPES);
