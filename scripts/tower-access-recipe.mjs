/** Two private homes per level, reached through a continuous shared stair hall. */
export function towerAccess(definition, layouts) {
  const rooms = layouts.get('apartments');
  layouts.delete('apartments');
  definition.sections = [
    { id: 'west-home', role: 'apartments', x: 0, y: 0, w: 3, d: 5, floor: 0, floors: 12, layout: 'west-home.layout.json' },
    { id: 'east-home', role: 'apartments', x: 3, y: 0, w: 4, d: 5, floor: 0, floors: 12, layout: 'east-home.layout.json' },
    { id: 'stair-hall', role: 'shared-circulation', x: 0, y: 5, w: 7, d: 2, floor: 0, floors: 12, layout: 'stair-hall.layout.json' },
  ];
  for (const side of ['west', 'east']) layouts.set(`${side}-home`, structuredClone(rooms));
  layouts.set('stair-hall', [{ id: 'hall', kind: 'living', floor: 0, x: 0, y: 0, w: 1, d: 1, finish: 'linoleum', contents: [] }]);
  definition.connections = Array.from({ length: 12 }, (_, floor) => ['west', 'east'].map(side => ({
    a: `${side}-home/${floor}/living`, b: `stair-hall/${floor}/hall`, at: .5, width: .3,
  }))).flat();
  definition.openings = [{ floor: 0, side: 'south', at: 4.5 / 7, kind: 'door' }];
  definition.stairs = Array.from({ length: 11 }, (_, floor) => ({
    a: `stair-hall/${floor}/hall`, b: `stair-hall/${floor + 1}/hall`,
    x: 1.05 / 7, y: (5.05 + floor % 2) / 7, w: 2.9 / 7, d: .9 / 7, rotation: 90,
  }));
  definition.floorVoids = Array.from({ length: 11 }, (_, floor) => ({ floor: floor + 1, x: 1, y: 5 + floor % 2, w: 3, d: 1 }));
}
