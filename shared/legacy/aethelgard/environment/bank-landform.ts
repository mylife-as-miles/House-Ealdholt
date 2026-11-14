/** Runtime-derived clearing relief. No private asset coordinates or scene state.
 * All values are valley-local metres; the caller owns every returned buffer. */
export interface EaldholtLandformRect { readonly minX:number;readonly maxX:number;readonly minZ:number;readonly maxZ:number }
export interface EaldholtLandformSurface { readonly positions:ArrayLike<number>;readonly indices:ArrayLike<number> }
export interface EaldholtLandformLand extends EaldholtLandformSurface {
  readonly normals:ArrayLike<number>;readonly colours:ArrayLike<number>;readonly uv:ArrayLike<number>;readonly wetness:ArrayLike<number>;
}
/** Local terrain engineering dimensions, not geographic map coordinates. */
export interface EaldholtRiparianCorridor { readonly width:number;readonly blendWidth:number }
export function validateEaldholtRiparianCorridor(value:EaldholtRiparianCorridor|undefined):void {
  if(value!==undefined&&(!value||!Number.isFinite(value.width)||value.width<=0||!Number.isFinite(value.blendWidth)||value.blendWidth<=0))throw Error('Invalid riparian corridor.');
}
export function ealdholtRiparianDisplacementWeight(distance:number,corridor:EaldholtRiparianCorridor|undefined):number {
  return corridor?smooth((distance-corridor.width)/corridor.blendWidth):1;
}
export interface EaldholtBankLandformInput {
  readonly land:EaldholtLandformLand;readonly water:readonly[EaldholtLandformSurface,EaldholtLandformSurface];
  readonly sourceEnvelope:EaldholtLandformRect;readonly protectedFootprints:readonly EaldholtLandformRect[];readonly profile:'desktop'|'quest';
  readonly riparianCorridor?:EaldholtRiparianCorridor;
}
export interface EaldholtBankLandformBuffers {
  readonly positions:Float32Array;readonly normals:Float32Array;readonly colours:Float32Array;readonly uv:Float32Array;
  readonly wetness:Float32Array;readonly indices:Uint16Array;readonly trianglesAdded:number;readonly bufferBytes:number;
  readonly bounds:{readonly min:readonly[number,number,number];readonly max:readonly[number,number,number]};
  readonly movedVertices:number;readonly protectedVertices:number;readonly maximumRaise:number;
}
type Point=[number,number,number];
type Vertex={p:Point;n:Point;c:Point;uv:[number,number];wet:number;weight:number};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
const rectDistance=(r:EaldholtLandformRect,x:number,z:number)=>Math.hypot(Math.max(r.minX-x,0,x-r.maxX),Math.max(r.minZ-z,0,z-r.maxZ));
const overlaps=(a:EaldholtLandformRect,b:EaldholtLandformRect)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minZ<=b.maxZ&&a.maxZ>=b.minZ;
const up=(a:Point,b:Point,c:Point)=>(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
const key=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
export function createEaldholtLandformBankSampler(water:EaldholtBankLandformInput['water']) {
  const sections=water.map((s,which)=>{
    if(s.positions.length<12||s.positions.length%6)throw Error('Landform needs paired water strips.');
    const result:Point[][]=[];
    for(let i=0;i<s.positions.length;i+=6){const a=[s.positions[i],s.positions[i+1],s.positions[i+2]]as Point,b=[s.positions[i+3],s.positions[i+4],s.positions[i+5]]as Point;
      if(![...a,...b].every(Number.isFinite)||Math.abs(a[which?2:0]-b[which?2:0])>.001)throw Error('Invalid paired water frame.');
      result.push([a,b].sort((a,b)=>a[which?0:2]-b[which?0:2]));}
    return result.sort((a,b)=>a[0][which?2:0]-b[0][which?2:0]);
  });
  return(x:number,z:number)=>{
    let distance=Infinity,level=sections[1][0][0][1],along=z,side=1;
    for(let which=0;which<2;which++){const rows=sections[which],axis=which?2:0,value=which?z:x;
      for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i];if(value<a[0][axis]||value>b[0][axis])continue;
        const t=(value-a[0][axis])/(b[0][axis]-a[0][axis]);
        const low=mix(a[0][which?0:2],b[0][which?0:2],t),high=mix(a[1][which?0:2],b[1][which?0:2],t);
        const d=which?x-high:Math.max(low-z,z-high);
        if(d<distance){distance=d;level=mix(a[0][1],b[0][1],t);along=value;side=which?1:z<(low+high)/2?-1:1;}break;
      }
    }
    return{distance,level,along,side};
  };
}

/** One connected clearing landform, with conservative untouched support faces.
 * Refinement interpolates the old planes before applying any relief. */
export function createEaldholtBankLandformBuffers(input:EaldholtBankLandformInput):EaldholtBankLandformBuffers {
  const {land,profile,sourceEnvelope,protectedFootprints,riparianCorridor}=input,count=land.positions.length/3;
  validateEaldholtRiparianCorridor(riparianCorridor);
  const validRect=(r:EaldholtLandformRect)=>[r.minX,r.maxX,r.minZ,r.maxZ].every(Number.isFinite)&&r.minX<=r.maxX&&r.minZ<=r.maxZ;
  if(!['desktop','quest'].includes(profile)||!validRect(sourceEnvelope)||!protectedFootprints.every(validRect)||!Number.isInteger(count)||count<3||count>55000
    ||land.normals.length!==count*3||land.colours.length!==count*3||land.uv.length!==count*2||land.wetness.length!==count||land.indices.length%3)throw Error('Invalid landform intake.');
  const vertices:Vertex[]=Array.from({length:count},(_,i)=>({p:[land.positions[i*3],land.positions[i*3+1],land.positions[i*3+2]],n:[land.normals[i*3],land.normals[i*3+1],land.normals[i*3+2]],
    c:[land.colours[i*3],land.colours[i*3+1],land.colours[i*3+2]],uv:[land.uv[i*2],land.uv[i*2+1]],wet:land.wetness[i],weight:0}));
  if(vertices.some(v=>![...v.p,...v.n,...v.c,...v.uv,v.wet].every(Number.isFinite)||v.wet<0||v.wet>1||v.n[1]<=0))throw Error('Nonfinite or downward landform intake.');
  const faces=Array.from({length:land.indices.length/3},(_,i)=>[land.indices[i*3],land.indices[i*3+1],land.indices[i*3+2]]);
  if(faces.some(f=>f.some(i=>!Number.isInteger(i)||i<0||i>=count)||up(vertices[f[0]].p,vertices[f[1]].p,vertices[f[2]].p)<=0))throw Error('Invalid landform topology.');
  const counts=new Map<string,{a:number;b:number;count:number}>();
  for(const face of faces)for(let j=0;j<3;j++){const a=face[j],b=face[(j+1)%3],k=key(a,b),e=counts.get(k);if(e){if(++e.count>2)throw Error('Nonmanifold landform.');}else counts.set(k,{a,b,count:1});}
  const boundary=[...counts.values()].filter(e=>e.count===1),fixed=new Set(boundary.flatMap(e=>[e.a,e.b])),bank=createEaldholtLandformBankSampler(input.water);
  function weight(p:Point):number {
    const [x,y,z]=p,b=bank(x,z);if(b.distance<=.65||y<=b.level+.1)return 0;
    let edgeDistance=Infinity,guardDistance=Infinity;
    for(const e of boundary){const a=vertices[e.a].p,q=vertices[e.b].p,dx=q[0]-a[0],dz=q[2]-a[2],length=dx*dx+dz*dz;
      const t=length?clamp(((x-a[0])*dx+(z-a[2])*dz)/length):0;edgeDistance=Math.min(edgeDistance,Math.hypot(x-a[0]-t*dx,z-a[2]-t*dz));}
    for(const r of protectedFootprints)guardDistance=Math.min(guardDistance,rectDistance(r,x,z));
    return smooth((rectDistance(sourceEnvelope,x,z)-1)/6)*smooth((edgeDistance-.7)/5)*smooth((b.distance-.65)/5)*smooth((guardDistance-.8)/4)*ealdholtRiparianDisplacementWeight(b.distance,riparianCorridor);
  }
  for(const v of vertices)v.weight=weight(v.p);
  const contact=new Set<number>();
  for(let i=0;i<faces.length;i++)if(faces[i].some(id=>{const p=vertices[id].p,b=bank(p[0],p[2]);return b.distance<=.1&&p[1]<=b.level+.1;}))contact.add(i);
  // Preserve the actual baseline support triangles, including their slopes and
  // interpolated shading. Never introduce thin refinements under a whole crown.
  const supportGuards=protectedFootprints.map(r=>({minX:r.minX-.8,maxX:r.maxX+.8,minZ:r.minZ-.8,maxZ:r.maxZ+.8}));
  for(let id=0;id<faces.length;id++){
    const p=faces[id].map(i=>vertices[i].p),box={minX:Math.min(...p.map(v=>v[0])),maxX:Math.max(...p.map(v=>v[0])),minZ:Math.min(...p.map(v=>v[2])),maxZ:Math.max(...p.map(v=>v[2]))};
    if(supportGuards.some(r=>overlaps(box,r)))contact.add(id);
  }
  type Edge={a:number;b:number;faces:Set<number>;score:number;mid:Vertex|null};
  const edges=new Map<string,Edge>(),candidates=new Set<Edge>();
  const midpoint=(a:Vertex,b:Vertex):Vertex=>{const p=a.p.map((v,k)=>Math.fround((v+b.p[k])/2))as Point;return{p,n:a.n.map((v,k)=>(v+b.n[k])/2)as Point,
    c:a.c.map((v,k)=>(v+b.c[k])/2)as Point,uv:a.uv.map((v,k)=>(v+b.uv[k])/2)as[number,number],wet:(a.wet+b.wet)/2,weight:weight(p)};};
  function rank(e:Edge){candidates.delete(e);if(e.faces.size!==2||[...e.faces].some(i=>contact.has(i)))return;
    const a=vertices[e.a],b=vertices[e.b],length=Math.hypot(a.p[0]-b.p[0],a.p[2]-b.p[2]);if(length<(profile==='quest'?5.5:4.5))return;
    e.mid??=midpoint(a,b);const influence=Math.max(a.weight,b.weight,e.mid.weight);if(influence<.001)return;
    for(const i of e.faces){const f=faces[i],j=f.findIndex((v,k)=>key(v,f[(k+1)%3])===key(e.a,e.b)),p=vertices[f[j]].p,q=vertices[f[(j+1)%3]].p,r=vertices[f[(j+2)%3]].p;
      if(up(p,e.mid.p,r)<=1e-7||up(e.mid.p,q,r)<=1e-7)return;}
    e.score=length*length*(.3+influence);candidates.add(e);
  }
  function add(id:number){const f=faces[id];for(let j=0;j<3;j++){const a=f[j],b=f[(j+1)%3],k=key(a,b);let e=edges.get(k);if(!e){e={a,b,faces:new Set(),score:0,mid:null};edges.set(k,e);}e.faces.add(id);rank(e);}}
  function remove(id:number){const f=faces[id];for(let j=0;j<3;j++){const k=key(f[j],f[(j+1)%3]),e=edges.get(k)!;e.faces.delete(id);candidates.delete(e);if(!e.faces.size)edges.delete(k);else rank(e);}}
  for(let i=0;i<faces.length;i++)add(i);
  for(let pass=0;pass<(profile==='quest'?750:2000)&&candidates.size;pass++){
    let edge:Edge|null=null;for(const e of candidates)if(!edge||e.score>edge.score)edge=e;if(!edge)break;
    const owners=[...edge.faces],id=vertices.length;vertices.push(edge.mid!);for(const face of owners)remove(face);
    for(const face of owners){const f=faces[face],j=f.findIndex((a,i)=>key(a,f[(i+1)%3])===key(edge!.a,edge!.b)),a=f[j],b=f[(j+1)%3],c=f[(j+2)%3];
      faces[face]=[a,id,c];const extra=faces.length;faces.push([id,b,c]);add(face);add(extra);}
  }
  const eligible=new Uint8Array(vertices.length);eligible.fill(1);
  const sourceGuard={minX:sourceEnvelope.minX-.8,maxX:sourceEnvelope.maxX+.8,minZ:sourceEnvelope.minZ-.8,maxZ:sourceEnvelope.maxZ+.8};
  const guards=protectedFootprints.map(r=>({minX:r.minX-.8,maxX:r.maxX+.8,minZ:r.minZ-.8,maxZ:r.maxZ+.8}));
  for(let id=0;id<faces.length;id++){
    const p=faces[id].map(i=>vertices[i].p),box={minX:Math.min(...p.map(v=>v[0])),maxX:Math.max(...p.map(v=>v[0])),minZ:Math.min(...p.map(v=>v[2])),maxZ:Math.max(...p.map(v=>v[2]))};
    // Refine first, then preserve complete original-grade corridor faces.
    // This is one continuous water-relative band, never individual tree pads.
    const riparian=riparianCorridor&&faces[id].some(i=>bank(vertices[i].p[0],vertices[i].p[2]).distance<=riparianCorridor.width);
    if(contact.has(id)||riparian||overlaps(box,sourceGuard)||guards.some(r=>overlaps(box,r)))for(const i of faces[id])eligible[i]=0;
  }
  let movedVertices=0,protectedVertices=0,maximumRaise=0;
  const raises=new Float32Array(vertices.length),span=Math.max(40,sourceEnvelope.maxX-sourceEnvelope.minX);
  for(let i=0;i<vertices.length;i++){
    const v=vertices[i];if(fixed.has(i)||!eligible[i]||v.weight<=.000001){protectedVertices++;continue;}
    const b=bank(v.p[0],v.p[2]),u=(b.along-sourceEnvelope.minX)/span;
    // Unequal broad shoulders share a low saddle. Their bank-top width changes
    // gently along the existing shore, rather than repeating ridges or bumps.
    const width=11+4*Math.sin(u*4.1+.5),inset=b.distance;
    const masses=.42+.8*Math.exp(-(((u-.28)/.24)**2))+.46*Math.exp(-(((u-.79)/.19)**2));
    const shoulder=smooth((inset-1)/width)*(1-smooth((inset-31)/29));
    const raise=Math.min(3,(b.side<0?2.8:2.05)*masses)*shoulder*v.weight;
    if(raise<.000001)continue;v.p[1]=Math.fround(v.p[1]+raise);raises[i]=raise;maximumRaise=Math.max(maximumRaise,raise);movedVertices++;
  }
  const positions=Float32Array.from(vertices.flatMap(v=>v.p)),normals=Float32Array.from(vertices.flatMap(v=>v.n)),sums=new Float64Array(vertices.length*3);
  for(const f of faces){const a=vertices[f[0]].p,b=vertices[f[1]].p,c=vertices[f[2]].p,ab=b.map((v,k)=>v-a[k]),ac=c.map((v,k)=>v-a[k]);
    const n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    if(n[1]<=0||!n.every(Number.isFinite))throw Error('Landform created invalid support.');
    for(const id of f)for(let k=0;k<3;k++)sums[id*3+k]+=n[k];
  }
  for(let i=0;i<vertices.length;i++)if(raises[i]){
    const v=vertices[i],length=Math.hypot(sums[i*3],sums[i*3+1],sums[i*3+2]);if(!(length>0))throw Error('Unsupported landform vertex.');
    for(let k=0;k<3;k++)normals[i*3+k]=sums[i*3+k]/length;
    const b=bank(v.p[0],v.p[2]),u=(b.along-sourceEnvelope.minX)/span,slope=Math.hypot(normals[i*3],normals[i*3+2])/normals[i*3+1];
    const grass=smooth((b.distance-(1.8+1.2*Math.sin(u*5+.4)))/7),rock=smooth((slope-.24)/.42)*smooth((raises[i]-.8)/1.5)*.65;
    const soil:Point=[.071,.050,.030],turf:Point=[.035,.063,.025],stone:Point=[.085,.088,.073];
    const blend=v.weight*.92;v.c=v.c.map((value,k)=>mix(value,mix(mix(soil[k],turf[k],grass),stone[k],rock),blend))as Point;
    v.wet=mix(v.wet,(1-grass)*.52,blend);
  }
  const colours=Float32Array.from(vertices.flatMap(v=>v.c)),uv=Float32Array.from(vertices.flatMap(v=>v.uv)),wetness=Float32Array.from(vertices.map(v=>v.wet)),indices=Uint16Array.from(faces.flat());
  const min:Point=[Infinity,Infinity,Infinity],max:Point=[-Infinity,-Infinity,-Infinity];for(const v of vertices)for(let k=0;k<3;k++){min[k]=Math.min(min[k],v.p[k]);max[k]=Math.max(max[k],v.p[k]);}
  return{positions,normals,colours,uv,wetness,indices,trianglesAdded:faces.length-land.indices.length/3,
    bufferBytes:[positions,normals,colours,uv,wetness,indices].reduce((n,a)=>n+a.byteLength,0),bounds:{min,max},movedVertices,protectedVertices,maximumRaise};
}
