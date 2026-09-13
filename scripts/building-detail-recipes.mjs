/** Authoring recipes only. Production reads the owned JSON building packages. */
export function buildingDetails(id, depth) {
  const mount = (id, kind, gx, width, text) => ({ id, kind, floor: 0, gx, gy: depth - 1, side: 'south', width, text });
  switch (id) {
    case 'auto-repair-shop': return [mount('west-shutter', 'roll-up-door', 0, 2), mount('east-shutter', 'roll-up-door', 4, 2)];
    case 'boarding-house': return [mount('front-porch', 'porch', 2, 4),
      ...[2,5].map((gx,i) => ({ ...mount(`front-dormer-${i+1}`, 'dormer', gx, 1), floor: 2 })),
      ...[1,2].map(floor => ({ ...mount(`escape-${floor}`, 'fire-escape', 0, 2), floor }))];
    case 'farmhouse-rear-wing': return [mount('farm-porch', 'porch', 2, 3)];
    case 'clock-hall': return [
      mount('hall-steps', 'entry-steps', 4, 3),
      { id: 'south-clock', kind: 'clock-face', floor: 4, gx: 4, gy: 5, side: 'south', width: 3 },
      { id: 'east-clock', kind: 'clock-face', floor: 4, gx: 6, gy: 2, side: 'east', width: 4 },
    ];
    case 'roadside-diner': return [mount('diner-sign', 'signboard', 1, 3, 'CLOVER DINER'), mount('kitchen-exhaust', 'roof-duct', 8, 1)];
    case 'bakery': return [mount('bakery-sign', 'signboard', 1, 3, 'BAKERY'),
      mount('west-display','display-glazing',0,2),mount('east-display','display-glazing',3,2)];
    case 'small-grocery': return [mount('west-display','display-glazing',0,3),mount('east-display','display-glazing',5,3)];
    case 'neighborhood-theater': return [mount('star-marquee', 'marquee', 3, 4, 'STAR THEATER')];
    default: return undefined;
  }
}
