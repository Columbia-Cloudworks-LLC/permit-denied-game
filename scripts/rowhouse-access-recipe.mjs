/** Preserve the narrow rowhouse envelope with a compact two-lane stair hall. */
export function rowhouseAccess(definition, layouts) {
  delete layouts.home;
  const fixture = (id, kind, x, y, w, d, h) => ({ id, kind, x, y, w, d, h, rotation: 0 });
  const room = (id, kind, x, y, w, d, contents, finish = 'plank') => ({ id, kind, floor: 0, x: x / 3, y: y / 7, w: w / 3, d: d / 7, finish, contents });
  const rooms = upper => [
    room('hall', 'living', 0, 0, 2, 4, [], 'linoleum'),
    room('bath', 'bathroom', 2, 0, 1, 4, [fixture('toilet', 'toilet', .15, .1, .5, .22, .7)], 'tile'),
    room('front', upper ? 'bedroom' : 'living', 0, 4, 2, 3, upper
      ? [fixture('bed', 'bed', .12, .12, .7, .6, .7)]
      : [fixture('sofa', 'sofa', .08, .3, .75, .25, .8), fixture('table', 'table', .3, .7, .35, .2, .65)]),
    room('side', upper ? 'storage' : 'kitchen', 2, 4, 1, 3, upper
      ? [fixture('wardrobe', 'cabinet', .15, .15, .65, .3, 1.2)]
      : [fixture('counter', 'counter', .1, .1, .3, .65, .8), fixture('fridge', 'fridge', .55, .1, .35, .25, 1.2)], upper ? 'plank' : 'tile'),
  ];
  const connections = [
    { a: 'hall', b: 'bath', at: .5, width: .3 },
    { a: 'hall', b: 'front', at: .5, width: .3 },
    { a: 'front', b: 'side', at: .5, width: .3 },
  ];
  layouts.ground = { partitions: true, rooms: rooms(false), connections };
  layouts.upper = { partitions: true, rooms: rooms(true), connections };
  definition.sections = [
    { id: 'ground', role: 'living-floor', x: 0, y: 0, w: 3, d: 7, floor: 0, floors: 1, layout: 'ground.layout.json' },
    { id: 'upper', role: 'bedroom-floors', x: 0, y: 0, w: 3, d: 7, floor: 1, floors: 2, layout: 'upper.layout.json' },
  ];
  definition.connections = [];
  definition.openings = [{ floor: 0, side: 'south', at: .3, kind: 'door' }];
  definition.stairs = [0, 1].map(floor => ({
    a: floor === 0 ? 'ground/0/hall' : 'upper/1/hall', b: `upper/${floor + 1}/hall`,
    x: (floor + .05) / 3, y: 1.05 / 7, w: .9 / 3, d: 2.9 / 7,
  }));
  definition.floorVoids = [0, 1].map(floor => ({ floor: floor + 1, x: floor, y: 1, w: 1, d: 3 }));
}
