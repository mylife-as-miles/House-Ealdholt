import { sampleEaldholtWoodlandSupport, type EaldholtWoodlandSurface, type EaldholtWoodlandVillage } from './river-woodland';

export interface EaldholtMarginPlacement { x:number;y:number;z:number;yaw:number;scale:number;footprint:number;normal:readonly[number,number,number] }
export interface EaldholtMarginPlacements { grass:EaldholtMarginPlacement[];stones:EaldholtMarginPlacement[] }
export const EALDHOLT_RIVER_MARGIN=Object.freeze({
  desktop:Object.freeze({maximumTriangles:12000,grassTarget:32,stoneTarget:6}),
  quest:Object.freeze({maximumTriangles:3000,grassTarget:10,stoneTarget:4}),
});
export interface EaldholtRiverOutcropBuffers {
  positions:Float32Array;normals:Float32Array;uv:Float32Array;indices:Uint16Array;
  readonly forms:3;readonly triangles:180;readonly byteLength:number;readonly footprintRadius:number;
  readonly bounds:{min:readonly[number,number,number];max:readonly[number,number,number]};
}
/** Original compact outcrop: a bedded slab, a squat angular stone and a low
 * fractured plate. Each closed60-triangle form has its own silhouette and
 * bedding height. Flat geological facets and metre-based side/top UVs replace
 * the old perturbed20-face pebble; no source geometry or private data is used. */
export function createEaldholtRiverOutcropBuffers():EaldholtRiverOutcropBuffers{
  const positions:number[]=[],normals:number[]=[],uv:number[]=[],indices:number[]=[];
  const outline=[[-1,-.55],[-.73,.64],[-.12,1],[.7,.77],[1,.1],[.74,-.7],[.1,-1],[-.65,-.9]];
  const forms=[{x:-.35,z:.12,w:1.65,d:1.05,h:.64,yaw:.12,shear:.11},
    {x:.62,z:.35,w:1,d:.9,h:.47,yaw:-.34,shear:-.08},
    {x:.20,z:-.58,w:.72,d:1.15,h:.33,yaw:.53,shear:.07}];
  for(const form of forms){
    const rings:number[][][]=[],levels=[[-.065,.84],[form.h*.1,1],[form.h*.72,.90],[form.h,.56]],cos=Math.cos(form.yaw),sin=Math.sin(form.yaw);
    for(let level=0;level<levels.length;level++){
      const [y,radius]=levels[level];rings.push(outline.map(([x,z])=>{
        const px=x*form.w*.5*radius+form.shear*level/3,pz=z*form.d*.5*radius-.045*level;
        return[form.x+px*cos+pz*sin,y,form.z-px*sin+pz*cos];
      }));
    }
    const perimeter=outline.reduce((sum,a,i)=>{const b=outline[(i+1)%8];return sum+Math.hypot((b[0]-a[0])*form.w*.5,(b[1]-a[1])*form.d*.5);},0);
    function face(a:number[],b:number[],c:number[],ta:number[],tb:number[],tc:number[],cap=0){
      const cross=()=>{const x=b[0]-a[0],y=b[1]-a[1],z=b[2]-a[2],u=c[0]-a[0],v=c[1]-a[1],w=c[2]-a[2];return[y*w-z*v,z*u-x*w,x*v-y*u];};
      let normal=cross();const outward=cap?normal[1]*cap:normal[0]*((a[0]+b[0]+c[0])/3-form.x)+normal[2]*((a[2]+b[2]+c[2])/3-form.z);
      if(outward<0){[b,c]=[c,b];[tb,tc]=[tc,tb];normal=cross();}const length=Math.hypot(...normal);
      if(length<1e-10)throw Error('Original outcrop has a degenerate facet.');
      for(const [point,texture]of [[a,ta],[b,tb],[c,tc]]){indices.push(positions.length/3);positions.push(...point);normals.push(...normal.map(n=>n/length));uv.push(...texture);}
    }
    for(let ring=0;ring<3;ring++)for(let i=0;i<8;i++){
      const next=(i+1)%8,a=rings[ring][i],b=rings[ring][next],c=rings[ring+1][i],d=rings[ring+1][next];
      const u=i/8*perimeter,v=(i+1)/8*perimeter;
      face(a,b,d,[u,a[1]],[v,b[1]],[v,d[1]]);face(a,d,c,[u,a[1]],[v,d[1]],[u,c[1]]);
    }
    for(const [ring,direction]of [[0,-1],[3,1]])for(let i=1;i<7;i++){
      const [a,b,c]=[rings[ring][0],rings[ring][i],rings[ring][i+1]];face(a,b,c,[a[0],a[2]],[b[0],b[2]],[c[0],c[2]],direction);
    }
  }
  const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i+=3)for(let j=0;j<3;j++){min[j]=Math.min(min[j],positions[i+j]);max[j]=Math.max(max[j],positions[i+j]);}
  const data={positions:Float32Array.from(positions),normals:Float32Array.from(normals),uv:Float32Array.from(uv),indices:Uint16Array.from(indices)};
  return{...data,forms:3,triangles:180,byteLength:Object.values(data).reduce((sum,array)=>sum+array.byteLength,0),
    footprintRadius:Math.hypot(...min.map((n,i)=>Math.max(Math.abs(n),Math.abs(max[i])))),bounds:{min,max}};
}
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
function randomStream(){let seed=0x59461acf;return()=>{seed=Math.imul(seed^seed>>>15,1|seed);seed^=seed+Math.imul(seed^seed>>>7,61|seed);return((seed^seed>>>14)>>>0)/4294967296;};}

/** A narrow discontinuous bank margin supported by the actual rendered mesh.
 * Source meshes/actor placements are never serialized here. No village roots,
 * underwater plant bases, outer-edge scatter or uniform planting rows. */
export function createEaldholtRiverMarginPlacements(input:{
  land:EaldholtWoodlandSurface;water:EaldholtWoodlandSurface;village:EaldholtWoodlandVillage;
  grassRadius:number;stoneRadius?:number;maximumGrass:number;maximumStones:number;profile:'desktop'|'quest';
}):EaldholtMarginPlacements {
  const {land,water,village,grassRadius,maximumGrass,maximumStones}=input,stoneRadius=input.stoneRadius??createEaldholtRiverOutcropBuffers().footprintRadius;
  if(!Number.isFinite(grassRadius)||grassRadius<0||!Number.isFinite(stoneRadius)||stoneRadius<=0||stoneRadius>4||!Number.isInteger(maximumGrass)||maximumGrass<0||maximumGrass>40||!Number.isInteger(maximumStones)||maximumStones<0||maximumStones>8)throw Error('Invalid bounded river-margin budget.');
  if(land.positions.length%3||land.indices.length%3||water.positions.length<12||water.positions.length%6)throw Error('River margin needs actual land triangles and paired water banks.');
  const sections:{x:number;low:number;high:number;level:number}[]=[];
  for(let i=0;i<water.positions.length;i+=6){
    const p=water.positions,x=(p[i]+p[i+3])/2;
    if(!Number.isFinite(x)||Math.abs(p[i]-p[i+3])>.001)throw Error('Invalid paired river strip.');
    sections.push({x,low:Math.min(p[i+2],p[i+5]),high:Math.max(p[i+2],p[i+5]),level:(p[i+1]+p[i+4])/2});
  }
  sections.sort((a,b)=>a.x-b.x);const west=sections[0].x,east=sections[sections.length-1].x;
  if(!(east>west))throw Error('River strip has no longitudinal extent.');
  function riverAt(x:number){for(let i=1;i<sections.length;i++)if(x>=sections[i-1].x&&x<=sections[i].x){const a=sections[i-1],b=sections[i],t=(x-a.x)/(b.x-a.x);return{low:mix(a.low,b.low,t),high:mix(a.high,b.high,t),level:mix(a.level,b.level,t)};}return null;}
  let south=Infinity,north=-Infinity;for(let i=2;i<land.positions.length;i+=3){south=Math.min(south,land.positions[i]);north=Math.max(north,land.positions[i]);}
  const random=randomStream(),result:EaldholtMarginPlacements={grass:[],stones:[]};
  const bends=sections.slice(1,-1).map((section,i)=>{
    const a=sections[i],b=sections[i+2],center=(p:typeof section)=>(p.low+p.high)/2;
    return{x:section.x,score:Math.abs((center(b)-center(section))/(b.x-section.x)-(center(section)-center(a))/(section.x-a.x))};
  }).filter(p=>(p.x-west)/(east-west)>.25&&(p.x-west)/(east-west)<.9).sort((a,b)=>b.score-a.score||a.x-b.x);
  const clusters:{x:number;side:number}[]=[];
  for(const bend of bends)if(clusters.every(p=>Math.abs(p.x-bend.x)>(east-west)*.085)){
    clusters.push({x:bend.x,side:clusters.length%3===2?-1:1});if(clusters.length>=Math.max(4,maximumStones))break;
  }
  if(!clusters.length)clusters.push({x:mix(west,east,.6),side:1});
  const occupied=new Set<number>();
  function populate(kind:'grass'|'stones',maximum:number){
    for(let attempt=0;attempt<maximum*70&&result[kind].length<maximum;attempt++){
      const clusterIndex=attempt%clusters.length,cluster=clusters[clusterIndex];if(kind==='stones'&&occupied.has(clusterIndex))continue;
      const scale=kind==='grass'?.85+random()*.5:.72+random()*.31,footprint=(kind==='grass'?grassRadius:stoneRadius)*scale;
      const anchor=kind==='grass'&&result.stones.length?result.stones[attempt%result.stones.length]:null;
      const x=(anchor?.x??cluster.x)+(random()+random()-1)*(kind==='grass'?4:input.profile==='quest'?8:1.2);
      const bank=riverAt(x);if(!bank)continue;
      const offset=footprint+(kind==='grass'?.7+random()*3:input.profile==='quest'?1.2+random()*3.6:.2+random()*.9);
      const side=input.profile==='quest'&&kind==='stones'&&Math.floor(attempt/clusters.length)%2?-cluster.side:cluster.side;
      const z=anchor?anchor.z+(random()+random()-1)*3:(side<0?bank.low:bank.high)+side*offset;
      if(x-footprint<west+2||x+footprint>east-2||z-footprint<south+2||z+footprint>north-2)continue;
      if(x-footprint<village.maxX&&x+footprint>village.minX&&z-footprint<village.maxZ&&z+footprint>village.minZ)continue;
      // Deliberate breaks let the damp bank remain visible between clumps.
      const phase=(x-west)/(east-west);if(phase>.495&&phase<.515||phase>.685&&phase<.705)continue;
      const centre=sampleEaldholtWoodlandSupport(land,x,z);if(!centre||centre.slope>(kind==='grass'?.65:.55)||centre.height<bank.level+.025||sampleEaldholtWoodlandSupport(water,x,z)!==null)continue;
      const px=sampleEaldholtWoodlandSupport(land,x+.03,z),nx=sampleEaldholtWoodlandSupport(land,x-.03,z),pz=sampleEaldholtWoodlandSupport(land,x,z+.03),nz=sampleEaldholtWoodlandSupport(land,x,z-.03);
      if(!px||!nx||!pz||!nz)continue;
      const gx=(px.height-nx.height)/.06,gz=(pz.height-nz.height)/.06,length=Math.hypot(gx,1,gz);
      const normal:readonly[number,number,number]=[-gx/length,1/length,-gz/length];
      let valid=true,minHeight=centre.height,maxHeight=centre.height,maxPlaneError=0,maximumWaterLevel=bank.level;
      for(let point=0;point<8&&valid;point++){
        const angle=point*Math.PI/4,sx=x+Math.cos(angle)*footprint,sz=z+Math.sin(angle)*footprint,shore=riverAt(sx),support=sampleEaldholtWoodlandSupport(land,sx,sz);
        if(!support||!shore||support.height<shore.level+.025||sz>shore.low-.1&&sz<shore.high+.1||sampleEaldholtWoodlandSupport(water,sx,sz)!==null){valid=false;break;}
        minHeight=Math.min(minHeight,support.height);maxHeight=Math.max(maxHeight,support.height);
        maximumWaterLevel=Math.max(maximumWaterLevel,shore.level);
        maxPlaneError=Math.max(maxPlaneError,Math.abs(support.height-(centre.height+gx*(sx-x)+gz*(sz-z))));
      }
      // Whole grass clumps follow the actual local tangent. Reject curvature,
      // rather than rejecting a planar dry bank merely because it slopes.
      const lowestGrassRoot=centre.height-Math.hypot(gx,gz)*footprint-.008;
      if(!valid||(kind==='grass'?maxPlaneError>.045||lowestGrassRoot<maximumWaterLevel+.01:maxPlaneError>.085))continue;
      if(result.grass.concat(result.stones).some(p=>Math.hypot(p.x-x,p.z-z)<(p.footprint+footprint)*.8))continue;
      result[kind].push({x,y:centre.height,z,yaw:random()*Math.PI*2,scale,footprint,normal});if(kind==='stones')occupied.add(clusterIndex);
    }
  }
  populate('stones',maximumStones);if(grassRadius>0)populate('grass',maximumGrass);return result;
}
