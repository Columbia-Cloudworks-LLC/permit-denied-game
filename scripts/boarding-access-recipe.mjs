/** Private boarding rooms around a two-lane shared stair hall. */
export function boardingAccess(definition, layouts) {
  const template = layouts.get('east-rooms');
  layouts.delete('west-rooms');
  layouts.delete('east-rooms');
  definition.sections = definition.sections.filter(s => s.id === 'commons');
  for (const side of ['west', 'east']) for (const [end, y, d] of [['north', 0, 3], ['south', 3, 4]]) {
    const id = `${side}-${end}`;
    const rooms = structuredClone(template);
    if (side === 'west') for (const room of rooms) room.x = 1 - room.x - room.w;
    layouts.set(id, rooms);
    definition.sections.push({ id, role: 'boarding-room', x: side === 'west' ? 0 : 5, y, w: 3, d, floor: 1, floors: 2, layout: `${id}.layout.json` });
  }
  layouts.set('stair-hall', [{ id: 'hall', kind: 'living', floor: 0, x: 0, y: 0, w: 1, d: 1, finish: 'linoleum', contents: [] }]);
  definition.sections.push({ id: 'stair-hall', role: 'shared-circulation', x: 3, y: 0, w: 2, d: 7, floor: 1, floors: 2, layout: 'stair-hall.layout.json' });
  const item = (id, kind, x, y, w, d, h) => ({ id, kind, x, y, w, d, h, rotation: 0 });
  layouts.get('commons')[0].contents = [
    item('west-sofa', 'sofa', .05, .12, .25, .2, .8),
    item('east-sofa', 'sofa', .7, .12, .25, .2, .8),
    item('dining-table', 'table', .25, .68, .5, .22, .65),
    item('shared-counter', 'counter', .43, .04, .14, .09, .8),
  ];
  definition.connections = [];
  for (let floor = 1; floor <= 2; floor++) for (const side of ['west', 'east']) for (const end of ['north', 'south']) {
    definition.connections.push({ a: `${side}-${end}/${floor}/bedroom`, b: `stair-hall/${floor}/hall`, at: .5, width: .3 });
  }
  definition.stairs = [0, 1].map(floor => ({
    a: floor === 0 ? 'commons/0/common-room' : 'stair-hall/1/hall', b: `stair-hall/${floor + 1}/hall`,
    x: (3.05 + floor) / 8, y: 1.05 / 7, w: .9 / 8, d: 2.9 / 7,
  }));
  definition.floorVoids = [0, 1].map(floor => ({ floor: floor + 1, x: 3 + floor, y: 1, w: 1, d: 3 }));
}
