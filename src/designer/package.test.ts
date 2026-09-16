import { describe, expect, it } from 'vitest';
import { BUILDING_FILES, parseBuildingPackages } from '../world/archetypes';
import { constructionFiles, newFromTemplate, openBuildingPackage, parseDraftPackage, virtualFileMap } from './package';

describe('designer virtual map', () => {
  it('parses a porch-house draft against existing construction files only', () => {
    const draft = newFromTemplate('porch-house', 'draft-porch-house');
    expect(draft.id).toBe('draft-porch-house');
    expect(draft.files.some(file => file.name.endsWith('.building.json'))).toBe(true);
    expect(draft.files.some(file => file.name.endsWith('.layout.json'))).toBe(true);
    const map = virtualFileMap(draft);
    expect(Object.keys(map).every(path => path.endsWith('.construction.json') || path.includes('/draft/'))).toBe(true);
    expect(Object.keys(map).some(path => path.endsWith('.construction.json'))).toBe(true);
    const parsed = parseBuildingPackages(map);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.id).toBe('draft-porch-house');
    expect(BUILDING_FILES[Object.keys(BUILDING_FILES).find(path => path.includes('/porch-house/') && path.endsWith('.building.json'))!] as { id: string }).toEqual(
      expect.objectContaining({ id: 'porch-house' }),
    );
    const result = parseDraftPackage(draft);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.definition.construction.id).toBe('timber-house');
  });

  it('opens porch-house without mutating ARCHETYPES files and reports invalid JSON', () => {
    const listed = Object.keys(BUILDING_FILES).find(path => path.endsWith('.building.json') && (BUILDING_FILES[path] as { id: string }).id === 'porch-house')!;
    const opened = openBuildingPackage(listed);
    expect(opened.id).toBe('porch-house');
    expect(parseDraftPackage(opened).ok).toBe(true);
    const constructions = constructionFiles();
    expect(Object.values(constructions).some(value => (value as { id: string }).id === 'timber-house')).toBe(true);
    const broken = { ...opened, files: opened.files.map(file => file.name.endsWith('.building.json') ? { ...file, text: '{ not json' } : file) };
    const result = parseDraftPackage(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/malformed JSON/);
  });
});
