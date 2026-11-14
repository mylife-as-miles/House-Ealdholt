import type { PieceColor, PieceType, ShowcaseFrame, ShowcasePiece } from './types';

export type StageQuality = 'low' | 'medium' | 'high';
export type StageView = 'cinematic' | 'board' | 'side' | 'battle' | 'arena';
export interface StageGeometry { positions: number[]; normals: number[]; colors: number[]; indices: number[] }
export interface StageMaterial { color: number; metalness: number; roughness: number; emissive?: number; opacity?: number }
export interface StageObject { name: string; geometry: string; material: string; position?: [number, number, number]; arena?: number; backdrop?: boolean }
export interface StageBlueprint { geometries: Record<string, StageGeometry>; materials: Record<string, StageMaterial>; objects: StageObject[] }
export const STAGE_SQUARE = .1;
export const STAGE_BOARD_Y = .075;
export const STAGE_BOUNDS = Object.freeze({ width: 1.05, depth: 1.16, height: .46, floor: -.02 });
const roles: PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];
const rgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const empty = (): StageGeometry => ({ positions: [], normals: [], colors: [], indices: [] });
function triangle(g: StageGeometry, a: readonly number[], b: readonly number[], c: readonly number[], color: number): void {
  const x = b[0]-a[0], y=b[1]-a[1], z=b[2]-a[2], u=c[0]-a[0], v=c[1]-a[1], w=c[2]-a[2];
  const nx=y*w-z*v, ny=z*u-x*w, nz=x*v-y*u, length=Math.hypot(nx,ny,nz), start=g.positions.length/3;
  if(length<1e-12)return;
  const col=rgb(color);
  for (const p of [a,b,c]) { g.positions.push(p[0],p[1],p[2]); g.normals.push(nx/length,ny/length,nz/length); g.colors.push(...col); }
  g.indices.push(start,start+1,start+2);
}
function box(g: StageGeometry, x: number, y: number, z: number, width: number, height: number, depth: number, color: number, yaw=0): void {
  const c=Math.cos(yaw),s=Math.sin(yaw), points: number[][]=[];
  for (const [dx,dy,dz] of [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]) {
    const px=dx*width/2,pz=dz*depth/2;points.push([x+px*c+pz*s,y+dy*height/2,z-px*s+pz*c]);
  }
  for(const [a,b,c1,d] of [[1,0,3,2],[4,5,6,7],[0,4,7,3],[5,1,2,6],[3,7,6,2],[0,1,5,4]]) {
    triangle(g,points[a],points[b],points[c1],color);triangle(g,points[a],points[c1],points[d],color);
  }
}
/** Chamfered solid with continuous bevel bands, shared by both engine adapters. */
function bevel(g:StageGeometry,x:number,y:number,z:number,w:number,h:number,d:number,b:number,color:number):void {
  const outline=(width:number,depth:number)=>[[-width/2+b,-depth/2],[width/2-b,-depth/2],[width/2,-depth/2+b],[width/2,depth/2-b],[width/2-b,depth/2],[-width/2+b,depth/2],[-width/2,depth/2-b],[-width/2,-depth/2+b]];
  const loops=[{y:y-h/2,w:w-2*b,d:d-2*b},{y:y-h/2+b,w,d},{y:y+h/2-b,w,d},{y:y+h/2,w:w-2*b,d:d-2*b}].map(r=>outline(r.w,r.d).map(([px,pz])=>[x+px,r.y,z+pz]));
  for(let row=0;row<3;row++)for(let i=0;i<8;i++){const j=(i+1)%8;triangle(g,loops[row][i],loops[row+1][j],loops[row][j],color);triangle(g,loops[row][i],loops[row+1][i],loops[row+1][j],color);}
  for(let i=0;i<8;i++){const j=(i+1)%8;triangle(g,[x,y+h/2,z],loops[3][j],loops[3][i],color);triangle(g,[x,y-h/2,z],loops[0][i],loops[0][j],color);}
}
function lathe(g: StageGeometry, profile: readonly (readonly [number,number])[], segments: number, body: number, trim: number, ox=0, oz=0): void {
  for(let row=0;row<profile.length-1;row++) {
    const [r0,y0]=profile[row],[r1,y1]=profile[row+1];
    const color=(row===1||row===3||row===profile.length-4)?trim:body;
    for(let i=0;i<segments;i++) {
      const a=i*Math.PI*2/segments,b=(i+1)*Math.PI*2/segments;
      const p=[ox+Math.sin(a)*r0,y0,oz+Math.cos(a)*r0],q=[ox+Math.sin(b)*r0,y0,oz+Math.cos(b)*r0];
      const r=[ox+Math.sin(b)*r1,y1,oz+Math.cos(b)*r1],t=[ox+Math.sin(a)*r1,y1,oz+Math.cos(a)*r1];
      triangle(g,p,q,r,color);triangle(g,p,r,t,color);
    }
  }
}
function sphere(g: StageGeometry,x:number,y:number,z:number,radius:number,segments:number,color:number):void {
  const profile: [number,number][]=[];
  for(let i=0;i<=8;i++){const a=i*Math.PI/8;profile.push([Math.sin(a)*radius,y-Math.cos(a)*radius]);}
  lathe(g,profile,segments,color,color,x,z);
}
function polygon(g: StageGeometry, points: readonly (readonly [number,number])[], depth:number,color:number,yaw=0):void {
  const vertices=points.map(([x,y])=>[x,y]), ids=vertices.map((_,i)=>i), faces:number[][]=[];
  const cross=(a:number,b:number,c:number)=>(vertices[b][0]-vertices[a][0])*(vertices[c][1]-vertices[a][1])-(vertices[b][1]-vertices[a][1])*(vertices[c][0]-vertices[a][0]);
  let area=0;for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length];area+=a[0]*b[1]-b[0]*a[1];}
  if(area<0)vertices.reverse();
  let guard=0;
  while(ids.length>2&&guard++<100){let clipped=false;for(let j=0;j<ids.length;j++){
    const a=ids[(j+ids.length-1)%ids.length],b=ids[j],c=ids[(j+1)%ids.length];if(cross(a,b,c)<=1e-10)continue;
    if(ids.some(p=>p!==a&&p!==b&&p!==c&&cross(a,b,p)>=0&&cross(b,c,p)>=0&&cross(c,a,p)>=0))continue;
    faces.push([a,b,c]);ids.splice(j,1);clipped=true;break;
  }if(!clipped)break;}
  const transform=(i:number,z:number)=>{const [x,y]=vertices[i];return [x*Math.cos(yaw)+z*Math.sin(yaw),y,-x*Math.sin(yaw)+z*Math.cos(yaw)];};
  for(const [a,b,c] of faces){triangle(g,transform(a,depth/2),transform(b,depth/2),transform(c,depth/2),color);triangle(g,transform(c,-depth/2),transform(b,-depth/2),transform(a,-depth/2),color);}
  for(let i=0;i<vertices.length;i++){const j=(i+1)%vertices.length;triangle(g,transform(i,-depth/2),transform(j,-depth/2),transform(j,depth/2),color);triangle(g,transform(i,-depth/2),transform(j,depth/2),transform(i,depth/2),color);}
}
function pieceGeometry(role:PieceType,color:PieceColor,quality:StageQuality):StageGeometry {
  const g=empty(),segments=quality==='low'?12:quality==='medium'?18:24;
  const body=color==='w'?0xe6ddc5:0x284c59,trim=color==='w'?0xa17d42:0x9baeb0;
  const foot:[number,number][]=[[0,0],[.030,0],[.036,.005],[.036,.010],[.031,.015],[.030,.022],[.024,.028]];
  const heights={p:.112,n:.115,b:.138,r:.125,q:.151,k:.157};
  const h=heights[role],profile:[number,number][]=[...foot,[.020,.035],[.014,.048],[.011,h-.030],[.019,h-.014],[.023,h-.009],[.023,h-.003],[.018,h]];
  if(role==='p') profile.push([.015,h+.004],[.020,h+.014],[.021,h+.023],[.017,h+.033],[.009,h+.039],[0,h+.042]);
  else profile.push([0,h]);
  lathe(g,profile,segments,body,trim);
  if(role==='r'){
    lathe(g,[[0,h-.002],[.023,h-.002],[.028,h+.004],[.028,h+.023],[.021,h+.023],[.021,h+.012],[0,h+.012]],segments,body,trim);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;box(g,Math.sin(a)*.024,h+.030,Math.cos(a)*.024,.015,.018,.015,trim,a);}
  }
  if(role==='b'){
    // A cut mitre rather than a featureless sphere preserves the bishop silhouette.
    polygon(g,[[-.018,h+.004],[-.021,h+.028],[-.010,h+.047],[.002,h+.061],[.012,h+.046],[.001,h+.026],[.007,h+.021],[.017,h+.039],[.023,h+.023],[.016,h+.004]],.022,body);
    sphere(g,0,h+.063,0,.005,segments,trim);
  }
  if(role==='n'){
    // Original extruded horse profile, with an undercut jaw and swept mane.
    polygon(g,[[-.024,h-.008],[-.020,h+.026],[-.027,h+.047],[-.014,h+.072],[-.010,h+.093],[.002,h+.083],[.015,h+.086],[.023,h+.069],[.038,h+.057],[.040,h+.040],[.027,h+.032],[.009,h+.044],[.004,h+.022],[.019,h-.008]],.028,body,Math.PI/2);
    box(g,0,h+.058,.019,.031,.004,.008,trim);
  }
  if(role==='q'){
    lathe(g,[[0,h],[.020,h],[.024,h+.014],[.030,h+.031],[.025,h+.037],[.019,h+.022],[0,h+.022]],segments,body,trim);
    for(let i=0;i<7;i++){const a=i*Math.PI*2/7;sphere(g,Math.sin(a)*.027,h+.041,Math.cos(a)*.027,.006,12,trim);}
    sphere(g,0,h+.051,0,.009,segments,body);
  }
  if(role==='k'){
    lathe(g,[[0,h],[.020,h],[.024,h+.012],[.021,h+.023],[.011,h+.028],[0,h+.028]],segments,body,trim);
    box(g,0,h+.052,0,.010,.048,.010,trim);box(g,0,h+.059,0,.035,.009,.010,trim);
  }
  return g;
}
function ring(g:StageGeometry,x:number,y:number,z:number,radius:number,tube:number,color:number,segments:number):void {
  for(let i=0;i<segments;i++)for(let j=0;j<6;j++){
    const point=(a:number,b:number)=>[x+Math.cos(a)*(radius+Math.cos(b)*tube),y+Math.sin(a)*(radius+Math.cos(b)*tube),z+Math.sin(b)*tube];
    const a=i*Math.PI*2/segments,b=(i+1)*Math.PI*2/segments,c=j*Math.PI/3,d=(j+1)*Math.PI/3;
    triangle(g,point(a,c),point(b,c),point(b,d),color);triangle(g,point(a,c),point(b,d),point(a,d),color);
  }
}
export function buildStageBlueprint(quality:StageQuality='high'):StageBlueprint {
  const geometries:Record<string,StageGeometry>={},objects:StageObject[]=[];
  const materials:Record<string,StageMaterial>={
    piece:{color:0xffffff,metalness:.42,roughness:.3},stone:{color:0xffffff,metalness:.18,roughness:.62},
    tile:{color:0xffffff,metalness:.16,roughness:.53},brass:{color:0xffffff,metalness:.72,roughness:.28},wood:{color:0xffffff,metalness:.08,roughness:.74},
    crystal:{color:0xffffff,metalness:.38,roughness:.22},glow:{color:0x53ddce,metalness:.1,roughness:.5,emissive:0x11776e},
    backdrop:{color:0xffffff,metalness:.10,roughness:.86,opacity:.95},
    highlight:{color:0x50cdbb,metalness:0,roughness:1,emissive:0x268d7d,opacity:.34},
    check:{color:0xffad61,metalness:0,roughness:1,emissive:0x9b5228,opacity:.55},
  };
  const add=(name:string,material:string,geometry:StageGeometry,arena?:number,backdrop=false)=>{geometries[name]=geometry;objects.push({name,geometry:name,material,arena,backdrop});};
  for(const color of ['w','b'] as const)for(const role of roles)geometries[`${color}-${role}`]=pieceGeometry(role,color,quality);
  const base=empty();bevel(base,0,-.010,-.01,1.04,.020,1.14,.003,0x17262d);bevel(base,0,.012,0,1.04,.028,1.04,.004,0x101b23);bevel(base,0,.035,0,1.015,.018,1.015,.003,0x39484b);bevel(base,0,.051,0,.995,.018,.995,.003,0x172a31);add('stepped-stone-plinth','stone',base);
  const frame=empty(),panel=empty();for(const sign of [-1,1]){
    bevel(panel,sign*.455,.063,0,.105,.025,1.005,.003,0x3e302a);bevel(panel,0,.063,sign*.455,.800,.025,.105,.003,0x3e302a);
    for(const edge of [.404,.501]){box(frame,sign*edge,.077,0,.002,.002,1.0,0xbc965c);box(frame,0,.077,sign*edge,.80,.002,.002,0xbc965c);}
    for(const z of [-.455,.455]){box(frame,sign*.455,.077,z,.064,.002,.003,0xc5a773);box(frame,sign*.455,.077,z,.003,.002,.064,0xc5a773);}
  }add('recessed-border-panels','wood',panel);add('brass-hairline-inlay','brass',frame);
  const tiles=empty();for(let rank=0;rank<8;rank++)for(let file=0;file<8;file++)box(tiles,(file-3.5)*.1,.066,(3.5-rank)*.1,.099,.018,.099,(rank+file)%2===0?0x626b69:0x182c32);add('board-squares','tile',tiles);
  const inlay=empty();for(const s of [-1,1])for(let i=0;i<8;i++){const p=(i-3.5)*.1;box(inlay,p,.077,s*.435,.012,.002,.003,0xd4b47b);box(inlay,s*.435,.077,p,.003,.002,.012,0xd4b47b);}add('notation-inlay','brass',inlay);
  // Each arena is a compact original display surround, inspired by its supplied artwork.
  const ruins=empty(),ruinTrim=empty();
  for(const x of [-.35,0,.35]){
    for(const s of [-1,1]){box(ruins,x+s*.09,.19,-.48,.038,.28,.045,0x5e665e);box(ruinTrim,x+s*.09,.33,-.48,.055,.016,.065,0x88734d);}
    for(let i=0;i<8;i++){const a=i*Math.PI/8,b=(i+1)*Math.PI/8,r=.108,inner=.076;
      const p=(angle:number,rad:number,z:number)=>[x+Math.cos(angle)*rad,.325+Math.sin(angle)*rad,z];
      triangle(ruins,p(a,r,-.457),p(b,r,-.457),p(b,inner,-.457),0x697068);triangle(ruins,p(a,r,-.457),p(b,inner,-.457),p(a,inner,-.457),0x697068);
      triangle(ruins,p(a,inner,-.503),p(b,inner,-.503),p(b,r,-.503),0x555f59);triangle(ruins,p(a,inner,-.503),p(b,r,-.503),p(a,r,-.503),0x555f59);
      for(const rad of [inner,r]){triangle(ruins,p(a,rad,-.503),p(b,rad,-.503),p(b,rad,-.457),0x5b645d);triangle(ruins,p(a,rad,-.503),p(b,rad,-.457),p(a,rad,-.457),0x5b645d);}
    }
  }
  bevel(ruins,0,.079,-.515,1.025,.055,.125,.006,0x35464a);
  bevel(ruins,0,.118,-.525,1.0,.028,.105,.004,0x56615b);
  bevel(ruins,0,.421,-.525,1.035,.032,.105,.005,0x56615b);
  for(const x of [-.505,-.175,.175,.505])bevel(ruins,x,.269,-.538,.035,.287,.077,.003,0x3f514f);
  for(const side of [-1,1]){bevel(ruins,side*.49,.132,-.34,.055,.12,.12,.004,0x35464a);bevel(ruinTrim,side*.49,.199,-.34,.068,.014,.14,.002,0x9c7c4a);}
  add('arcade-stone','stone',ruins,0);add('arcade-capitals','brass',ruinTrim,0);
  const gateway=empty(),portal=empty();
  for(const s of [-1,1]){box(gateway,s*.39,.22,-.47,.075,.34,.09,0x29444b);box(gateway,s*.39,.40,-.47,.095,.025,.11,0x9d7e4c);box(gateway,s*.39,.10,-.47,.12,.035,.14,0x546166);}
  bevel(gateway,0,.089,-.513,1.02,.065,.13,.006,0x243d47);
  bevel(gateway,0,.122,-.52,.92,.018,.10,.003,0x597478);
  for(const side of [-1,1])bevel(gateway,side*.49,.208,-.50,.045,.25,.13,.004,0x1b303c);
  ring(portal,0,.239,-.50,.186,.012,0x76b9b5,quality==='low'?24:40);add('gateway-monoliths','stone',gateway,1);add('gateway-ring','glow',portal,1);
  const timber=empty(),hearths=empty();
  for(const s of [-1,1]){box(timber,s*.40,.22,-.49,.048,.34,.05,0x514336);box(timber,s*.40,.39,-.49,.065,.036,.07,0xa18459);box(timber,s*.22,.27,-.51,.035,.30,.038,0x514336,s*.3);}
  bevel(timber,0,.088,-.515,1.02,.06,.125,.006,0x372d28);
  for(const side of [-1,1])bevel(timber,side*.45,.17,-.48,.08,.14,.13,.004,0x68513b);
  box(timber,0,.40,-.49,.88,.045,.07,0x514336);box(timber,0,.34,-.49,.86,.022,.055,0x857052);
  for(const s of [-1,1]){lathe(hearths,[[0,.05],[.045,.05],[.038,.07],[.022,.10],[.018,.19],[.048,.205],[.05,.23],[0,.23]],12,0x68543c,0xb18a4e,s*.45,-.28);sphere(hearths,s*.45,.246,-.28,.025,12,0xe6a663);}
  add('timber-gallery','wood',timber,2);add('hearth-vessels','brass',hearths,2);
  const crystal=empty(),crystalBase=empty();
  for(let i=0;i<7;i++){const x=(i-3)*.13,h=.16+((i*7)%5)*.05,z=-.49+(i%2)*.025;lathe(crystal,[[0,.06],[.035,.06],[.041,.10],[.032,h-.035],[0,h]],5,i%2?0x53888d:0x7c809c,0x9eb9b5,x,z);box(crystalBase,x,.05,z,.10,.018,.12,0x293943);}
  bevel(crystalBase,0,.067,-.51,1.02,.055,.14,.006,0x263843);
  bevel(crystalBase,0,.095,-.51,.94,.012,.13,.002,0x647d83);
  add('crystal-spires','crystal',crystal,3);add('crystal-setting','stone',crystalBase,3);
  // Quiet full-aperture depth. Primary framing intentionally ignores this support set.
  const floor=empty();bevel(floor,0,-.034,-.45,2.8,.018,2.1,.006,0x24363c);
  for(const x of [-1.15,-.75,.75,1.15])box(floor,x,-.023,-.45,.003,.001,1.9,0x31434a);
  for(const z of [-1.2,-.8,-.4,0,.4])box(floor,0,-.023,z,2.6,.001,.003,0x31434a);
  add('receding-stone-floor','backdrop',floor,undefined,true);
  for(let arena=0;arena<4;arena++){
    const depth=empty();
    if(arena===0){
      for(const x of [-1.18,-.78,.78,1.18]){bevel(depth,x,.31,-1.16,.095,.66,.14,.009,0x263b40);bevel(depth,x,.66,-1.16,.14,.045,.19,.005,0x3c5053);}
      bevel(depth,0,.703,-1.16,2.55,.04,.17,.006,0x34494d);
      for(const side of [-1,1]){bevel(depth,side*1.08,.09,-.82,.29,.12,.8,.008,0x1e3137);bevel(depth,side*1.08,.16,-.82,.31,.025,.82,.004,0x34494d);}
    }else if(arena===1){
      for(const side of [-1,1]){bevel(depth,side*.98,.30,-1.1,.17,.66,.23,.014,0x203b47);bevel(depth,side*.98,.64,-1.1,.24,.045,.28,.006,0x3f5d65);bevel(depth,side*.77,.20,-.88,.06,.40,.08,.005,0x2e4b55);}
      bevel(depth,0,.695,-1.15,2.38,.045,.18,.006,0x2c4852);
    }else if(arena===2){
      for(const x of [-1.16,-.78,.78,1.16])bevel(depth,x,.31,-1.08,.085,.66,.12,.006,0x3a352e);
      for(const y of [.43,.67])bevel(depth,0,y,-1.08,2.5,.055,.13,.005,0x4a4337);
      for(const side of [-1,1])bevel(depth,side*1.02,.12,-.82,.32,.18,.75,.008,0x2f302b);
    }else{
      for(let i=0;i<9;i++){const side=i<5?-1:1,x=side*(.72+(i%5)*.12),h=.35+((i*7)%5)*.08;lathe(depth,[[0,-.02],[.075,-.02],[.095,.05],[.060,h-.1],[0,h]],5,i%2?0x2e4855:0x39475b,0x4e666c,x,-1.02+(i%3)*.09);}
    }
    add(`arena-${arena}-distant-silhouette`,'backdrop',depth,arena,true);
  }
  const marker=empty();box(marker,0,0,0,.097,.001,.097,0xffffff);geometries.marker=marker;
  return {geometries,materials,objects};
}
export function squarePosition(square:string):[number,number] { return [(square.charCodeAt(0)-100.5)*STAGE_SQUARE,(3.5-(Number(square[1])-1))*STAGE_SQUARE]; }
export function startingPieces():ShowcasePiece[] {
  const pieces:ShowcasePiece[]=[],back:PieceType[]=['r','n','b','q','k','b','n','r'];
  for(const color of ['w','b'] as const)for(let file=0;file<8;file++)for(const pawn of [false,true]){
    const rank=color==='w'?(pawn?2:1):(pawn?7:8),square=`${String.fromCharCode(97+file)}${rank}`;
    pieces.push({id:`preview-${square}`,color,type:pawn?'p':back[file],square});
  }return pieces;
}
export interface PiecePose { id:string; color:PieceColor; type:PieceType; x:number; y:number; z:number; scale:number; visible:boolean; fromX:number;fromZ:number;toX:number;toZ:number;progress:number;capture:boolean; }
/** Numeric animation state is shared; rendering adapters never own chess rules. */
export class StageMotion {
  readonly actors:PiecePose[]=[];
  private previous:ShowcaseFrame|null=null;
  private initialized=false;
  reducedMotion=false;
  paused=false;
  time=0;
  setFrame(frame:ShowcaseFrame|null):void {
    if(this.initialized&&frame===this.previous)return;
    for(let i=this.actors.length-1;i>=0;i--)if(!this.actors[i].visible||this.actors[i].capture)this.actors.splice(i,1);
    const pieces=frame?.pieces??startingPieces();
    const from=frame?.move?this.previous?.pieces.find(p=>p.square===frame.move!.from):null;
    const related=!!frame&&!!this.previous&&!!from&&frame.pieces.every(p=>this.previous!.pieces.some(old=>old.id===p.id));
    const animate=!this.reducedMotion&&related&&frame!.ply===this.previous!.ply+1;
    const wanted=new Set(pieces.map(p=>p.id));
    for(const actor of this.actors){if(actor.visible&&!wanted.has(actor.id)){actor.capture=animate;actor.progress=animate?0:1;if(!animate)actor.visible=false;}}
    for(const piece of pieces){let actor=this.actors.find(a=>a.id===piece.id);const [x,z]=squarePosition(piece.square);
      if(!actor){actor={id:piece.id,color:piece.color,type:piece.type,x,y:STAGE_BOARD_Y,z,scale:1,visible:true,fromX:x,fromZ:z,toX:x,toZ:z,progress:1,capture:false};this.actors.push(actor);}
      actor.color=piece.color;actor.type=piece.type;actor.fromX=actor.x;actor.fromZ=actor.z;actor.toX=x;actor.toZ=z;
      actor.progress=animate&&(actor.x!==x||actor.z!==z)?0:1;actor.capture=false;actor.visible=true;actor.scale=1;
      if(actor.progress===1){actor.x=x;actor.z=z;actor.y=STAGE_BOARD_Y;}
    }
    for(let i=this.actors.length-1;i>=0;i--)if(!this.actors[i].visible)this.actors.splice(i,1);
    this.previous=frame;this.initialized=true;
  }
  update(delta:number):void {
    if(this.paused)return;const dt=Math.min(.1,Math.max(0,delta));this.time+=dt;
    for(const a of this.actors){if(!a.visible||a.progress>=1)continue;a.progress=Math.min(1,a.progress+dt/.42);const t=a.progress,t2=t*t*(3-2*t);
      if(a.capture){a.scale=1-t2;a.y=STAGE_BOARD_Y-t2*.025;if(t===1)a.visible=false;continue;}
      a.x=t===1?a.toX:a.fromX+(a.toX-a.fromX)*t2;a.z=t===1?a.toZ:a.fromZ+(a.toZ-a.fromZ)*t2;a.y=t===1?STAGE_BOARD_Y:STAGE_BOARD_Y+Math.sin(t*Math.PI)*(a.type==='n'?.065:.016);
    }
  }
}
