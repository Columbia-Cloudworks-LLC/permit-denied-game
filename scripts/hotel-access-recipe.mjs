/** Private guest rooms around a shared hall, connected from lobby to service floor. */
export function hotelAccess(definition, layouts) {
  const guestRooms = layouts.get('rooms');
  const stockRooms = layouts.get('service');
  layouts.delete('rooms');
  layouts.delete('service');
  definition.sections = definition.sections.filter(s => s.id === 'lobby');
  const add = (id, role, x, y, w, d, floor, floors, rooms) => {
    definition.sections.push({ id, role, x, y, w, d, floor, floors, layout: `${id}.layout.json` });
    layouts.set(id, structuredClone(rooms));
  };
  for (const [edge, y, d] of [['north', 1, 3], ['south', 6, 2]]) {
    for (let unit = 0; unit < 2; unit++) add(`${edge}-${unit + 1}`, 'guest-room', 2 + unit * 4, y, 4, d, 1, 6, guestRooms);
  }
  const hall = [{ id: 'hall', kind: 'living', floor: 0, x: 0, y: 0, w: 1, d: 1, finish: 'linoleum', contents: [] }];
  add('guest-hall', 'shared-circulation', 2, 4, 8, 2, 1, 6, hall);
  add('service-hall', 'shared-circulation', 3, 4, 6, 2, 7, 1, hall);
  add('service-north', 'service', 3, 2, 6, 2, 7, 1, stockRooms);
  add('service-south', 'service', 3, 6, 6, 1, 7, 1, stockRooms);
  const lobby = layouts.get('lobby')[0];
  lobby.contents = [
    { id: 'west-seating', kind: 'sofa', x: .08, y: .12, w: .25, d: .15, h: .8, rotation: 0 },
    { id: 'east-seating', kind: 'sofa', x: .67, y: .12, w: .25, d: .15, h: .8, rotation: 0 },
    { id: 'lobby-table', kind: 'table', x: .06, y: .55, w: .18, d: .2, h: .65, rotation: 0 },
    { id: 'reception', kind: 'counter', x: .75, y: .6, w: .18, d: .18, h: .85, rotation: 0 },
  ];
  definition.connections = [];
  for (let floor = 1; floor <= 6; floor++) for (const edge of ['north', 'south']) for (let unit = 1; unit <= 2; unit++) {
    definition.connections.push({ a: `${edge}-${unit}/${floor}/bedroom`, b: `guest-hall/${floor}/hall`, at: .5, width: .3 });
  }
  for (const edge of ['north', 'south']) definition.connections.push({ a: `service-${edge}/7/stockroom`, b: 'service-hall/7/hall', at: .5, width: .4 });
  const roomAt = floor => floor === 0 ? 'lobby/0/common-room' : floor === 7 ? 'service-hall/7/hall' : `guest-hall/${floor}/hall`;
  definition.stairs = Array.from({ length: 7 }, (_, floor) => ({
    a: roomAt(floor), b: roomAt(floor + 1), x: 4.05 / 12, y: (4.05 + floor % 2) / 9, w: 2.9 / 12, d: .9 / 9, rotation: 90,
  }));
  definition.floorVoids = Array.from({ length: 7 }, (_, floor) => ({ floor: floor + 1, x: 4, y: 4 + floor % 2, w: 3, d: 1 }));
}
