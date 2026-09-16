import { BUILDING_FILES, parseBuildingPackages, type Archetype } from '../world/archetypes';

export type TemplateKind = 'porch-house' | 'box';

export interface DraftFile {
  name: string;
  path: string;
  text: string;
}

export interface DraftPackage {
  id: string;
  files: DraftFile[];
}

export interface PackageListItem {
  id: string;
  label: string;
  buildingPath: string;
}

const DRAFT_DIR = './data/buildings/draft';

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function directoryOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function constructionFiles(files: Record<string, unknown> = BUILDING_FILES): Record<string, unknown> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => path.endsWith('.construction.json')));
}

export function listBuildingPackages(files: Record<string, unknown> = BUILDING_FILES): PackageListItem[] {
  return Object.entries(files)
    .filter(([path]) => path.endsWith('.building.json'))
    .map(([buildingPath, value]) => {
      const entry = value as { id: string; label: string };
      return { id: entry.id, label: entry.label, buildingPath };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function openBuildingPackage(buildingPath: string, files: Record<string, unknown> = BUILDING_FILES): DraftPackage {
  const source = files[buildingPath] as { id: string } | undefined;
  if (!source || !buildingPath.endsWith('.building.json')) throw new Error(`Unknown building package ${buildingPath}`);
  const dir = directoryOf(buildingPath);
  const packFiles = Object.entries(files)
    .filter(([path]) => path.startsWith(`${dir}/`) && (path.endsWith('.building.json') || path.endsWith('.layout.json')))
    .sort(([a], [b]) => a.endsWith('.building.json') === b.endsWith('.building.json') ? a.localeCompare(b) : a.endsWith('.building.json') ? -1 : 1)
    .map(([path, value]) => ({ name: fileName(path), path, text: pretty(value) }));
  return { id: source.id, files: packFiles };
}

export function newFromTemplate(kind: TemplateKind, id: string, files: Record<string, unknown> = BUILDING_FILES): DraftPackage {
  const sourceId = kind === 'porch-house' ? 'porch-house' : 'ranch';
  const listed = listBuildingPackages(files).find(item => item.id === sourceId);
  if (!listed) throw new Error(`Missing template ${sourceId}`);
  const source = openBuildingPackage(listed.buildingPath, files);
  const dir = `${DRAFT_DIR}/${id}`;
  const filesOut = source.files.map(file => {
    if (!file.name.endsWith('.building.json')) {
      return { name: file.name, path: `${dir}/${file.name}`, text: file.text };
    }
    const entry = JSON.parse(file.text) as Record<string, unknown>;
    entry.id = id;
    entry.label = kind === 'box' ? 'DRAFT BOX' : 'DRAFT PORCH';
    delete entry.generationOrder;
    return { name: file.name, path: `${dir}/${file.name}`, text: pretty(entry) };
  });
  return { id, files: filesOut };
}

export function virtualFileMap(draft: DraftPackage, files: Record<string, unknown> = BUILDING_FILES): Record<string, unknown> {
  const map = constructionFiles(files);
  for (const file of draft.files) {
    try { map[file.path] = JSON.parse(file.text); }
    catch (error) { throw new Error(`${file.name}: malformed JSON: ${String(error)}`); }
  }
  return map;
}

export function parseDraftPackage(draft: DraftPackage, files: Record<string, unknown> = BUILDING_FILES): { ok: true; definition: Archetype } | { ok: false; error: string } {
  try {
    const definitions = parseBuildingPackages(virtualFileMap(draft, files));
    const definition = definitions.find(item => item.id === draft.id) ?? definitions[0];
    if (!definition) return { ok: false, error: 'No building parsed from the draft files.' };
    return { ok: true, definition };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function packageDump(draft: DraftPackage): string {
  return draft.files.map(file => `// ${file.name}\n${file.text.trimEnd()}`).join('\n\n');
}

export function nextDraftId(kind: TemplateKind, now = Date.now()): string {
  return `draft-${kind}-${now.toString(36)}`;
}
