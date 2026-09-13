/** Shared by the explicit authoring helper and the owned duplex package. */
export function independentDuplex(definition, layouts) {
  definition.connections = [];
  definition.openings = [.0625,.5625].map(at => ({ floor:0,side:'south',at,kind:'door' }));
  definition.stairs = [];
  definition.floorVoids = [];
  for (const [side, gx] of [['west-home',0],['east-home',4]]) {
    const layout = layouts[side];
    for (const room of layout.rooms) { room.x = .25 + room.x * .75; room.w *= .75; }
    layout.rooms.push({id:'stair-hall',kind:'living',floor:0,x:0,y:0,w:.25,d:1,finish:'plank',contents:[]});
    layout.connections.push(...['living','bedroom'].map(b=>({a:'stair-hall',b,at:.5,width:.35})));
    definition.stairs.push({a:`${side}/0/stair-hall`,b:`${side}/1/stair-hall`,x:(gx+.05)/8,y:1.05/5,w:.9/8,d:2.9/5});
    definition.floorVoids.push({floor:1,x:gx,y:1,w:1,d:3});
  }
}
