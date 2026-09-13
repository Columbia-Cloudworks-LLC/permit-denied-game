import { Container, Graphics, Text } from 'pixi.js';

export const STRIKE_DURATION = 1.7;
export class BowlingStrikes {
  readonly root = new Container();
  private cards: { node: Container; pins: Graphics; age: number }[] = [];
  get count(): number { return this.cards.length; }
  add(): void {
    if (this.cards.length === 8) this.cards.shift()!.node.destroy({ children: true });
    const node = new Container(), back = new Graphics(), pins = new Graphics();
    back.roundRect(-78,-21,156,42,10).fill({color:0x172a39,alpha:.95}).stroke({color:0xf5bf56,width:2});
    const label = new Text({text:'STRIKE!',style:{fontFamily:'Arial',fontSize:18,fontWeight:'900',fontStyle:'italic',fill:0xffd66f}});
    label.position.set(-17,-11); node.addChild(back,pins,label); this.root.addChild(node);
    this.cards.push({node,pins,age:0});
  }
  clear(): void { for (const c of this.cards) c.node.destroy({children:true}); this.cards=[]; }
  draw(dt: number, x: number, y: number, zoom: number): void {
    for (const c of this.cards) c.age += dt;
    for (const c of this.cards.filter(c=>c.age>=STRIKE_DURATION)) c.node.destroy({children:true});
    this.cards = this.cards.filter(c=>c.age<STRIKE_DURATION);
    this.root.position.set(x,y); this.root.scale.set(1/zoom);
    this.cards.forEach((c,i)=>{
      const t=c.age, kick=Math.min(1,t/.4), pop=1+.12*Math.sin(Math.min(1,t/.22)*Math.PI);
      c.node.position.set((i%2)*5,-64-(this.cards.length-1-i)*31-t*13);
      c.node.scale.set(pop); c.node.alpha=Math.min(1,(STRIKE_DURATION-t)/.5);
      c.pins.clear();
      // Ten little pins scatter around a ball, like a score-monitor strike graphic.
      for(let pin=0;pin<10;pin++) {
        const a=pin*2.399, px=-45+Math.cos(a)*(4+kick*14), py=Math.sin(a)*(4+kick*11);
        const tilt=(pin%2?1:-1)*kick*1.1, cos=Math.cos(tilt),sin=Math.sin(tilt);
        const points=[[-2,5],[-3,1],[-1,-3],[-1,-6],[1,-6],[1,-3],[3,1],[2,5]].flatMap(([u,v])=>[px+u!*cos-v!*sin,py+u!*sin+v!*cos]);
        c.pins.poly(points).fill(0xfff9e5);
        c.pins.circle(px+4*sin,py-4*cos,1.3).fill(0xd94a48);
      }
      c.pins.circle(-49+kick*6,11-kick*9,5).fill(0x51bac0);
    });
  }
}
