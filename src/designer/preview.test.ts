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

describe('designer climate presets', () => {
  it('dresses the isolated lot for a zone, and leaves it as authored without one', async () => {
    const { dressIsolateLot } = await import('./preview');
    const authored = instantiateIsolateDefinition(archetypeById('ranch'));
    dressIsolateLot(authored, { climateId: '', season: 'winter' });
    expect(authored.town.buildings[0]!.region).toBeUndefined();
    expect(authored.town.groundCondition).toBe('clear');

    const forms = new Set<string>();
    for (const id of ['ranch', 'cottage', 'porch-house', 'motel-room-block']) {
      const desert = instantiateIsolateDefinition(archetypeById(id));
      dressIsolateLot(desert, { climateId: 'sonoran-desert', season: 'winter' });
      const building = desert.town.buildings[0]!;
      expect(building.region?.walls).toBe('southwest');
      // A desert winter previews without snow.
      expect(desert.town.groundCondition).toBe('clear');
      expect(desert.town.look).not.toBe('winter');
      forms.add(building.roofForm?.id ?? 'classic');
    }
    expect([...forms].some(form => form === 'adobe-flat' || form === 'barrel-tile-gable')).toBe(true);

    const north = instantiateIsolateDefinition(archetypeById('ranch'));
    dressIsolateLot(north, { climateId: 'boreal', season: 'winter' });
    expect(north.town.groundCondition).toBe('snow');
    expect(north.town.buildings[0]!.roofForm).toBeUndefined();
  });
});
