/** Preserve stepped/U-shaped wings while giving each unit a private hall entrance. */
export function apartmentCirculation(definition, layouts) {
  const rearId=definition.id==='courtyard-apartment'?'rear':'main';
  const rear=definition.sections.find(s=>s.id===rearId), hallY=rear.d;
  const rearRooms=layouts.get(rearId);
  layouts.delete(rearId);
  definition.sections=definition.sections.filter(s=>s.id!==rearId);
  for(let i=0;i<3;i++) {
    const id=`${rearId}-${i+1}`;
    definition.sections.push({...rear,id,x:i*4,w:4,layout:`${id}.layout.json`});
    layouts.set(id,structuredClone(rearRooms));
  }
  definition.d+=2;
  for(const side of ['west','east']) {
    const wing=definition.sections.find(s=>s.id===side);wing.y+=2;
    const rooms=layouts.get(side);
    if(definition.id==='garden-apartment-block') {
      wing.w=4;wing.d=5;wing.x=side==='west'?0:8;definition.d=12;
      rooms.find(r=>r.id==='bedroom').contents.push(
        {id:'studio-counter',kind:'counter',x:.02,y:.75,w:.25,d:.18,h:.8,rotation:0},
        {id:'studio-fridge',kind:'fridge',x:.65,y:.75,w:.18,d:.18,h:1.2,rotation:0});
    }
    const hallWidth=1/wing.w, homeWidth=1-hallWidth;
    for(const r of rooms) {
      if(side==='west')r.x=1-r.x-r.w;
      r.x=(side==='east'?hallWidth:0)+r.x*homeWidth;r.w*=homeWidth;
    }
    rooms.push({id:'hall',kind:'living',floor:0,x:side==='west'?homeWidth:0,y:0,w:hallWidth,d:1,finish:'linoleum',contents:[]});
  }
  definition.sections.push({id:'shared-hall',role:'shared-circulation',x:0,y:hallY,w:12,d:2,floor:0,floors:3,layout:'shared-hall.layout.json'});
  layouts.set('shared-hall',[{id:'hall',kind:'living',floor:0,x:0,y:0,w:1,d:1,finish:'linoleum',contents:[]}]);
  definition.connections=[];
  for(let floor=0;floor<3;floor++) {
    for(let i=1;i<=3;i++)definition.connections.push({a:`${rearId}-${i}/${floor}/living`,b:`shared-hall/${floor}/hall`,at:.5,width:.3});
    for(const side of ['west','east'])if(floor<definition.sections.find(s=>s.id===side).floors)
      definition.connections.push({a:`${side}/${floor}/hall`,b:`shared-hall/${floor}/hall`,at:.5,width:.6});
  }
  definition.openings=[{floor:0,side:'south',at:.5,kind:'door',cell:{x:6,y:hallY+1}}];
  definition.stairs=[0,1].map(f=>({a:`shared-hall/${f}/hall`,b:`shared-hall/${f+1}/hall`,x:4.05/12,y:(hallY+f+.05)/definition.d,w:2.9/12,d:.9/definition.d,rotation:90}));
  definition.floorVoids=[0,1].map(f=>({floor:f+1,x:4,y:hallY+f,w:3,d:1}));
}
