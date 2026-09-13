/** Shared circulation with four private homes, rather than cross-unit doors. */
export function fourplexAccess(definition, layouts) {
  definition.w = 10;
  definition.sections.find(s => s.id === 'east-units').x = 6;
  definition.sections.push({id:'stair-hall',role:'shared-circulation',x:4,y:0,w:2,d:6,floor:0,floors:2,layout:'stair-hall.layout.json'});
  // Mirror the west homes so both entrances meet living rooms, not bathrooms.
  for (const r of layouts.get('west-units')) r.x = 1 - r.x - r.w;
  layouts.set('stair-hall',[{id:'hall',kind:'living',floor:0,x:0,y:0,w:1,d:1,finish:'linoleum',contents:[]}]);
  definition.connections = [0,1].flatMap(floor => ['west-units','east-units'].map(side => ({a:`${side}/${floor}/living`,b:`stair-hall/${floor}/hall`,at:.55,width:.35})));
  definition.openings = [{floor:0,side:'south',at:.55,kind:'door'}];
  definition.stairs = [{a:'stair-hall/0/hall',b:'stair-hall/1/hall',x:4.05/10,y:1.05/6,w:.9/10,d:2.9/6}];
  definition.floorVoids = [{floor:1,x:4,y:1,w:1,d:3}];
}
