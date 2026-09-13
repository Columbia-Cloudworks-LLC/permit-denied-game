/** A shared indoor corridor serves private rooms on both floors. */
export function motelAccess(definition, layouts) {
  definition.d = 7;
  definition.sections.push({id:'corridor',role:'shared-circulation',x:0,y:4,w:12,d:3,floor:0,floors:2,layout:'corridor.layout.json'});
  layouts.corridor = {partitions:true,rooms:[{id:'hall',kind:'living',floor:0,x:0,y:0,w:1,d:1,finish:'linoleum',contents:[]}],connections:[]};
  definition.connections = [0,1].flatMap(floor => [1,2,3,4].map(i => ({a:`room-${i}/${floor}/sleeping`,b:`corridor/${floor}/hall`,at:.55,width:.4})));
  definition.openings = [{floor:0,side:'south',at:.5,kind:'door'}];
  definition.stairs = [{a:'corridor/0/hall',b:'corridor/1/hall',x:.05/12,y:4.05/7,w:.9/12,d:2.9/7}];
  definition.floorVoids = [{floor:1,x:0,y:4,w:1,d:3}];
}
