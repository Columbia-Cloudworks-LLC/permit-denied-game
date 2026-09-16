import { describe, expect, it } from 'vitest';
import { archetypeById } from '../world/archetypes';
import { CATALOG_CAPTURE_DOZER } from '../debug/catalogCaptureDozer';
import { instantiateIsolateDefinition } from '../debug/isolateLot';

describe('designer isolate preview', () => {
  it('instantiates porch-house on the capture pad with the dozer parked off-lot', () => {
    const lot = instantiateIsolateDefinition(archetypeById('porch-house'));
    expect(lot.town.buildings).toHaveLength(1);
    expect(lot.town.buildings[0]!.archetypeId).toBe('porch-house');
    expect(lot.bay.intactFacade).toBe(true);
    expect(lot.bay.building?.cells.every(cell => cell.state !== 'gone')).toBe(true);
    expect(lot.dozer.x).toBe(CATALOG_CAPTURE_DOZER.x);
    expect(lot.dozer.y).toBe(CATALOG_CAPTURE_DOZER.y);
    expect(lot.pad).toBeGreaterThanOrEqual(12);
  });
});
