import {REALISTIC_TREE_COHORT_LIMIT,qualifyRealisticTreeCohort,type RealisticTreeCohort,type RealisticTreeCohortSource} from './realistic-tree-cohort';
import {EALDHOLT_REGIONAL_WORLD as POLICY} from './regional-world-policy';
import {sampleEaldholtFarGeography, type EaldholtFarGeography} from './far-surround';
import {createEaldholtWoodlandSupportIndex} from './far-woodland';
import type {EaldholtWoodlandSurface} from './river-woodland';
import {groundVegetationRoot,type VegetationRootContact} from './vegetation-root-contact';
import {REGIONAL_ROOT_CONTACTS} from './regional-root-contact-data';
import {REGIONAL_GROUNDCOVER_PLACEMENT_VERSION,validRegionalGroundcoverSource,type RegionalGroundcoverSource} from './regional-groundcover-policy';
import {redistributeRiparianGroundcover,type RegionalRiparianDiagnostics} from './regional-riparian-groundcover';
import {qualifyScannedShrubCohort,scannedShrubFootprint,type ScannedShrubCohort,type ScannedShrubCohortSource} from './scanned-shrub-policy';
import {qualifyNaturalRiparianCohort,type NaturalRiparianCohort,type NaturalRiparianSource} from './natural-riparian-policy';
export interface RegionalPrototype {id:string;height:number;canopyRadius:number;shrub:boolean;rootContact?:VegetationRootContact}
export interface RegionalCell {id:string;x:number;z:number;ids:Uint32Array}
export interface RegionalLandmark {id:'western-fort'|'temple-ruins';x:number;y:number;z:number;yaw:number;radius:number;foundationDepth:number}
export interface RegionalWorldLayout {version:string;realisticTrees?:RealisticTreeCohort;realisticForest01Trees?:RealisticTreeCohort;scannedShrubs?:ScannedShrubCohort;naturalRiparian?:NaturalRiparianCohort;villageFootprint?:EaldholtFarGeography['sourceEnvelope'];treeCount:number;shrubCount:number;placements:Float32Array;rocks:Float32Array;groundcover?:Float32Array;groundcoverVersion?:string;groundcoverRiparian?:number;groundcoverDiagnostics?:RegionalRiparianDiagnostics;cells:RegionalCell[];landmarks:RegionalLandmark[];attempts:number;rejected:Record<string,number>;species:number[]}
const random=(a:number,b:number)=>{let h=Math.imul(a^0x5f3759df,b+374761393);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
/** Smooth deterministic habitat, adapted from BakedVoxelLighting habitat.js
 * (MIT, SamG-Coder). Crownfall owns the domain, coast and exclusions. */
function noise(x:number,z:number,scale:number,lane:number){
 const ix=Math.floor(x/scale),iz=Math.floor(z/scale),tx=x/scale-ix,tz=z/scale-iz;
 const u=tx*tx*(3-2*tx),v=tz*tz*(3-2*tz),h=(dx:number,dz:number)=>random((ix+dx)*73856093^(iz+dz)*19349663,lane);
 return(h(0,0)*(1-u)+h(1,0)*u)*(1-v)+(h(0,1)*(1-u)+h(1,1)*u)*v;
}
/** Distance from the authored village, not distance from its centre. */
export function regionalVillageEdgeDistance(s:{minX:number;maxX:number;minZ:number;maxZ:number},x:number,z:number){
 return Math.hypot(Math.max(s.minX-x,0,x-s.maxX),Math.max(s.minZ-z,0,z-s.maxZ));
}
function edgeCandidate(s:{minX:number;maxX:number;minZ:number;maxZ:number},attempt:number){
 const w=s.maxX-s.minX,d=s.maxZ-s.minZ,along=random(attempt,51)*2*(w+d),depth=POLICY.villageEdge.minimumSetback+Math.pow(random(attempt,52),1.35)*POLICY.villageEdge.woodlandDepth;
 if(along<w)return{x:s.minX+along,z:s.minZ-depth};
 if(along<w+d)return{x:s.maxX+depth,z:s.minZ+along-w};
 if(along<2*w+d)return{x:s.maxX-(along-w-d),z:s.maxZ+depth};
 return{x:s.minX-depth,z:s.maxZ-(along-2*w-d)};
}
function coast(g:EaldholtFarGeography,z:number){const p=g.coastSamples;if(z<=p[0])return p[1];for(let i=2;i<p.length;i+=2)if(z<=p[i]){const t=(z-p[i-2])/(p[i]-p[i-2]);return p[i-1]*(1-t)+p[i+1]*t;}return p[p.length-1];}
export function createRegionalWorldLayout(input:{geography:EaldholtFarGeography;land:readonly EaldholtWoodlandSurface[];prototypes:readonly RegionalPrototype[];maximumTrees?:number;realisticTreeSource?:RealisticTreeCohortSource;realisticForest01Source?:RealisticTreeCohortSource;scannedShrubSource?:ScannedShrubCohortSource;naturalRiparianSource?:NaturalRiparianSource;village?:EaldholtFarGeography['sourceEnvelope'];villageLand?:readonly EaldholtWoodlandSurface[];groundcoverSource?:RegionalGroundcoverSource}):RegionalWorldLayout{
 const {geography:g,prototypes}=input,s=g.sourceEnvelope,v=input.village??s,maximum=input.maximumTrees??POLICY.additionalTrees;
 if(!Number.isInteger(maximum)||maximum<0||maximum>POLICY.additionalTrees||prototypes.length!==15||prototypes.some(p=>!Number.isFinite(p.height)||p.height<=0||!Number.isFinite(p.canopyRadius)||p.canopyRadius<=0))throw Error('Invalid regional forest source or population.');
 const contacts=prototypes.map(p=>p.rootContact??REGIONAL_ROOT_CONTACTS[p.id]);if(contacts.some(contact=>!contact))throw Error('Regional forest requires measured wood-root contacts.');
 const domain={minX:s.minX-450,maxX:s.maxX+POLICY.forestExtent.east,minZ:s.minZ-POLICY.forestExtent.north,maxZ:s.maxZ+POLICY.forestExtent.south};
 const outerSupport=createEaldholtWoodlandSupportIndex(input.land,domain),villageSupport=createEaldholtWoodlandSupportIndex(input.villageLand??[],s);
 const support={sample(x:number,z:number){return x>=s.minX&&x<=s.maxX&&z>=s.minZ&&z<=s.maxZ?villageSupport.sample(x,z)??outerSupport.sample(x,z):outerSupport.sample(x,z);}};
 const fortZ=s.minZ-POLICY.landmarks.westernFort.minimumVillageDistance-110,fortX=coast(g,fortZ)+140;
 const candidates:RegionalLandmark[]=[{id:'western-fort',x:fortX,y:0,z:fortZ,yaw:Math.PI,radius:POLICY.landmarks.westernFort.footprintRadius,foundationDepth:2},
  {id:'temple-ruins',x:s.maxX+POLICY.landmarks.templeRuins.minimumVillageDistance+150,y:0,z:s.minZ-600,yaw:.18,radius:POLICY.landmarks.templeRuins.footprintRadius,foundationDepth:2}];
 const landmarks:RegionalLandmark[]=[];
 for(const desired of candidates){let best:RegionalLandmark|null=null,score=Infinity;
  for(const ox of [-80,-40,0,40,80])for(const oz of [-80,-40,0,40,80]){const p={...desired,x:desired.x+ox,z:desired.z+oz};let y=-Infinity,low=Infinity,valid=true;
   for(const [dx,dz]of [[0,0],[-25,-25],[-25,25],[25,-25],[25,25]]){const ground=support.sample(p.x+dx,p.z+dz);if(!ground||sampleEaldholtFarGeography(g,p.x+dx,p.z+dz).kind!=='mainland'){valid=false;break;}y=Math.max(y,ground.height);low=Math.min(low,ground.height);}
   const cost=(y-low)*10+Math.hypot(ox,oz)*.005;if(valid&&cost<score){score=cost;best={...p,y,foundationDepth:Math.max(2,y-low+1)};}
  }if(best)landmarks.push(best);
 }
 const values:number[]=[],cells=new Map<string,{x:number;z:number;ids:number[]}>(),buckets=new Map<string,number[]>(),rejected:Record<string,number>={},species=Array<number>(15).fill(0);
 const add=(x:number,y:number,z:number,yaw:number,scale:number,variant:number)=>{
  const id=values.length/6;values.push(x,y,z,yaw,scale,variant);species[variant]++;
  const key=Math.floor(x/5)+','+Math.floor(z/5),list=buckets.get(key);if(list)list.push(id);else buckets.set(key,[id]);
  const cx=Math.floor(x/POLICY.tileMetres),cz=Math.floor(z/POLICY.tileMetres),ck=cx+','+cz,cell=cells.get(ck);
  if(cell)cell.ids.push(id);else cells.set(ck,{x:(cx+.5)*POLICY.tileMetres,z:(cz+.5)*POLICY.tileMetres,ids:[id]});
 };
 const fail=(reason:string)=>{rejected[reason]=(rejected[reason]??0)+1;};
 const fullCell=(x:number,z:number,tree=false)=>(cells.get(Math.floor(x/POLICY.tileMetres)+','+Math.floor(z/POLICY.tileMetres))?.ids.length??0)>=(tree?Math.floor(POLICY.maximumTreesPerCell*.78):POLICY.maximumTreesPerCell);
 // BVL uses age-aware competition; Solstice uses dart throwing with denser
 // interiors. Uneven spacing lets crowns interlock without rows or cloned rings.
 const spacingFor=(variant:number,scale:number)=>[3.2,5,6][variant%3]*scale;
 const edgeTrees:number[]=[];

 let attempts=0;
 for(let attempt=0;attempt<maximum*80&&values.length/6<maximum;attempt++){
  attempts++;const angle=random(attempt,1)*Math.PI*2,localRadius=180+Math.pow(random(attempt,2),1.8)*1450,local=attempt%3===1,edge=attempt%3===0?edgeCandidate(v,attempt):null;
  const x=edge?.x??(local?(s.minX+s.maxX)/2+Math.cos(angle)*localRadius:domain.minX+random(attempt,1)*(domain.maxX-domain.minX));
  const z=edge?.z??(local?(s.minZ+s.maxZ)/2+Math.sin(angle)*localRadius:domain.minZ+random(attempt,2)*(domain.maxZ-domain.minZ));
  if(x<domain.minX||x>domain.maxX||z<domain.minZ||z>domain.maxZ)continue;
  if(fullCell(x,z,true)){fail('cell-budget');continue;}
  // Keep the source intact, while removing the artificial 24 m empty belt.
  if(x>=v.minX&&x<=v.maxX&&z>=v.minZ&&z<=v.maxZ){fail('authored-settlement');continue;}
  const field=sampleEaldholtFarGeography(g,x,z);if(field.kind!=='mainland'){fail('water');continue;}
  if(landmarks.some(p=>Math.hypot(x-p.x,z-p.z)<p.radius+12)){fail('landmark-clearing');continue;}
  const distance=Math.hypot(x-(s.minX+s.maxX)/2,z-(s.minZ+s.maxZ)/2);
  const edgeDistance=regionalVillageEdgeDistance(v,x,z),fringe=edgeDistance<POLICY.villageEdge.woodlandDepth;
  const gap=noise(x,z,31,823),opening=Math.max(0,Math.min(1,(gap-.72)/.17));
  const habitat=fringe?(.78+.14*noise(x,z,68,17))*(1-opening):noise(x,z,175,17)*.72+noise(x,z,530,29)*.28+.14*Math.max(0,1-distance/1250);
  if(habitat<.5||random(attempt,3)>(habitat-.42)*2.4){fail('natural-clearing');continue;}
  const ground=support.sample(x,z);if(!ground||ground.slope>.72||ground.height-g.seaLevel>620){fail('unsupported-or-alpine');continue;}
  // All four species and three ages come from the upstream geometry recipe.
  const age=random(attempt,4)<(fringe?.28:.14)?0:random(attempt,5)<.5?1:2;
  const moisture=noise(x,z,230,31),pine=ground.height-g.seaLevel>210||moisture<.27;
  const kind=pine?3:moisture>.65?1:random(attempt,6)<.55?0:2,variant=kind*3+age;
  const scale=.85+random(attempt,7)*.3,radius=prototypes[variant].canopyRadius*scale;
  if(edgeDistance<radius+POLICY.villageEdge.minimumSetback){fail('authored-canopy-clearance');continue;}
  const spacing=spacingFor(variant,scale);let overlap=false;
  for(let bx=Math.floor(x/5)-2;bx<=Math.floor(x/5)+2;bx++)for(let bz=Math.floor(z/5)-2;bz<=Math.floor(z/5)+2;bz++)for(const id of buckets.get(bx+','+bz)??[])if(Math.hypot(values[id*6]-x,values[id*6+2]-z)<(spacing+spacingFor(values[id*6+5],values[id*6+4]))*.5)overlap=true;
  if(overlap){fail('trunk-spacing');continue;}
  // Keep the complete canopy clear of rivers and sea, including narrow banks.
  let dry=true;for(let edge=0;edge<8;edge++){const a=edge*Math.PI/4;if(sampleEaldholtFarGeography(g,x+Math.cos(a)*radius,z+Math.sin(a)*radius).kind!=='mainland'){dry=false;break;}}
  if(!dry){fail('shore-canopy');continue;}
  const yaw=random(attempt,8)*Math.PI*2,root=groundVegetationRoot({x,z,yaw,scale,height:prototypes[variant].height,contact:contacts[variant],sample:support.sample});
  if(!root){fail('unsupported-root-footprint');continue;}
  if(fringe)edgeTrees.push(values.length/6);
  add(x,root.y,z,yaw,scale,variant);
 }
 if(values.length/6!==maximum)throw Error('Qualified regional tree population shortfall: '+values.length/6+' / '+maximum);
 const fringeTrees=edgeTrees.filter(id=>regionalVillageEdgeDistance(v,values[id*6],values[id*6+2])<=40);
 const shrubTarget=Math.min(POLICY.additionalShrubs,Math.floor(maximum/6));let shrubs=0;
 for(let attempt=0;attempt<shrubTarget*30&&shrubs<shrubTarget;attempt++){
  const tree=(fringeTrees.length&&attempt%4!==3?fringeTrees[Math.floor(random(attempt,40)*fringeTrees.length)]:Math.floor(random(attempt,40)*maximum))*6,angle=random(attempt,41)*Math.PI*2,radius=4+random(attempt,42)*14;
  const x=values[tree]+Math.cos(angle)*radius,z=values[tree+2]+Math.sin(angle)*radius;
  if(regionalVillageEdgeDistance(v,x,z)<POLICY.villageEdge.minimumSetback+2||landmarks.some(p=>Math.hypot(x-p.x,z-p.z)<p.radius+12)||sampleEaldholtFarGeography(g,x,z).kind!=='mainland')continue;
  if(fullCell(x,z))continue;
  const ground=support.sample(x,z);if(!ground||ground.slope>.58)continue;
  let clear=true;for(let bx=Math.floor(x/5)-1;bx<=Math.floor(x/5)+1;bx++)for(let bz=Math.floor(z/5)-1;bz<=Math.floor(z/5)+1;bz++)for(const id of buckets.get(bx+','+bz)??[])if((values[id*6]-x)**2+(values[id*6+2]-z)**2<4)clear=false;
  const variant=12+attempt%3,scale=.55+random(attempt,43)*.4,crown=prototypes[variant].canopyRadius*scale;
  if(regionalVillageEdgeDistance(v,x,z)<crown+POLICY.villageEdge.minimumSetback)continue;
  for(let edge=0;edge<8&&clear;edge++){const a=edge*Math.PI/4;if(sampleEaldholtFarGeography(g,x+Math.cos(a)*crown,z+Math.sin(a)*crown).kind!=='mainland')clear=false;}
  if(clear){const yaw=random(attempt,44)*Math.PI*2,root=groundVegetationRoot({x,z,yaw,scale,height:prototypes[variant].height,contact:contacts[variant],sample:support.sample});
   if(root){add(x,root.y,z,yaw,scale,variant);shrubs++;}}
 }
 if([...cells.values()].some(cell=>cell.ids.length>POLICY.maximumTreesPerCell))throw Error('Regional cell instance budget exceeded.');
 // Cluster the actual scanned boulders at woodland edges and banks. These
 // source-metre transforms persist independently of the visible LOD buffers.
 const rocks:number[]=[],rockBuckets=new Map<string,number[]>(),rockTarget=Math.min(POLICY.additionalRocks,Math.floor(maximum/10));
 for(let attempt=0;attempt<rockTarget*100&&rocks.length/6<rockTarget;attempt++){
  const cluster=Math.floor(attempt/8),tree=(fringeTrees.length&&cluster%4!==3?fringeTrees[Math.floor(random(cluster,70)*fringeTrees.length)]:Math.floor(random(cluster,70)*maximum))*6,a=random(attempt,71)*Math.PI*2,r=6+random(attempt,72)*22;
  const x=values[tree]+Math.cos(a)*r,z=values[tree+2]+Math.sin(a)*r,scale=attempt%8===0?1.1+random(attempt,73)*1.8:.22+random(attempt,73)*.75;
  if(regionalVillageEdgeDistance(v,x,z)<POLICY.villageEdge.minimumSetback+2||landmarks.some(p=>Math.hypot(x-p.x,z-p.z)<p.radius+12))continue;
  const ground=support.sample(x,z);if(!ground||ground.slope>.6||ground.height-g.seaLevel>620)continue;
  let clear=true;for(let e=0;e<8;e++){const t=e*Math.PI/4;if(sampleEaldholtFarGeography(g,x+Math.cos(t)*scale*1.1,z+Math.sin(t)*scale*1.1).kind!=='mainland'){clear=false;break;}}
  const bx=Math.floor(x/5),bz=Math.floor(z/5);
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
   for(const id of buckets.get((bx+dx)+','+(bz+dz))??[])if(Math.hypot(values[id*6]-x,values[id*6+2]-z)<scale+.7)clear=false;
   for(const id of rockBuckets.get((bx+dx)+','+(bz+dz))??[])if(Math.hypot(rocks[id*6]-x,rocks[id*6+2]-z)<scale+rocks[id*6+4])clear=false;
  }
  if(!clear)continue;const id=rocks.length/6,key=bx+','+bz;rocks.push(x,ground.height-scale*.12,z,random(attempt,74)*Math.PI*2,scale,attempt%3);
  const bucket=rockBuckets.get(key);if(bucket)bucket.push(id);else rockBuckets.set(key,[id]);
 }
 if(rocks.length/6!==rockTarget)throw Error('Qualified regional rock population shortfall.');
 // Borrowed source grass is rendered separately from tree cards. Only exterior
 // planting is allowed; exact support, water and fixture guards stay shared.
 const grass:number[]=[],grassBuckets=new Map<string,number[]>(),grassTarget=Math.min(POLICY.additionalGroundcover,Math.floor(maximum/4));
 for(let attempt=0;attempt<grassTarget*80&&grass.length/6<grassTarget;attempt++){
  const candidate=edgeCandidate(v,attempt+7919),x=candidate.x,z=candidate.z,d=regionalVillageEdgeDistance(v,x,z),size=.85+random(attempt,86)*.65;
  if(d<4+size*.7||d>90||sampleEaldholtFarGeography(g,x,z).kind!=='mainland'||landmarks.some(p=>Math.hypot(x-p.x,z-p.z)<p.radius+12))continue;
  if(noise(x,z,11,88)<.31||random(attempt,87)>.65)continue;
  const ground=support.sample(x,z);if(!ground||ground.slope>.52)continue;
  let clear=true;for(let edge=0;edge<4;edge++){const a=edge*Math.PI/2;if(sampleEaldholtFarGeography(g,x+Math.cos(a)*size*.7,z+Math.sin(a)*size*.7).kind!=='mainland')clear=false;}
  const bx=Math.floor(x/2),bz=Math.floor(z/2);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const id of grassBuckets.get((bx+dx)+','+(bz+dz))??[])if(Math.hypot(grass[id*6]-x,grass[id*6+2]-z)<.8)clear=false;
  const tx=Math.floor(x/5),tz=Math.floor(z/5);for(const id of buckets.get(tx+','+tz)??[])if(Math.hypot(values[id*6]-x,values[id*6+2]-z)<.65)clear=false;
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const id of rockBuckets.get((tx+dx)+','+(tz+dz))??[])if(Math.hypot(rocks[id*6]-x,rocks[id*6+2]-z)<rocks[id*6+4]*1.1+.5)clear=false;
  if(!clear)continue;const id=grass.length/6;grass.push(x,ground.height,z,random(attempt,89)*Math.PI*2,size,attempt%3);const key=bx+','+bz,list=grassBuckets.get(key);if(list)list.push(id);else grassBuckets.set(key,[id]);
 }

 let groundcoverRiparian=0,naturalRiparian:NaturalRiparianCohort|undefined;const groundcoverDiagnostics:RegionalRiparianDiagnostics={attempted:0,accepted:0,rejected:{}};
 if(validRegionalGroundcoverSource(input.groundcoverSource)){
  const fixtures:{x:number;z:number;radius:number}[]=landmarks.map(p=>({x:p.x,z:p.z,radius:p.radius+12}));
  // Only fixtures capable of touching the bounded bank reach need temporary
  // worker buckets; distant forest actors never gain a second resident copy.
  const nearReach=(x:number,radius:number)=>x+radius>=g.channelSamples[0]-10&&x-radius<=Math.min(g.riverFarX,s.maxX+650)+10;
  for(let at=0;at<values.length;at+=6){const radius=contacts[values[at+5]].radius*values[at+4];if(nearReach(values[at],radius))fixtures.push({x:values[at],z:values[at+2],radius});}
  // Match the existing scanned-boulder renderer's conservative 1.8 m bound.
  for(let at=0;at<rocks.length;at+=6){const radius=rocks[at+4]*1.8;if(nearReach(rocks[at],radius))fixtures.push({x:rocks[at],z:rocks[at+2],radius});}
  groundcoverRiparian=redistributeRiparianGroundcover({geography:g,village:v,grass,source:input.groundcoverSource,fixtures,diagnostics:groundcoverDiagnostics,footprint:outerSupport.groundcoverFootprint});
  if(input.naturalRiparianSource)naturalRiparian=qualifyNaturalRiparianCohort({source:input.naturalRiparianSource,grass:Float32Array.from(grass),riparian:groundcoverRiparian,geography:g,village:v,
   fixtures:fixtures.map(p=>({x:Math.fround(p.x),z:Math.fround(p.z),radius:p.radius+.001})),footprint:outerSupport.groundcoverFootprint});
 }
 const placements=Float32Array.from(values),realisticTrees=input.realisticTreeSource?qualifyRealisticTreeCohort({placements,source:input.realisticTreeSource,village:v,sample:support.sample,terrain:bounds=>[...outerSupport.projectedTriangles(bounds),...villageSupport.projectedTriangles(bounds)]}):undefined;
 const realisticForest01Trees=input.realisticForest01Source?qualifyRealisticTreeCohort({placements,source:input.realisticForest01Source,village:v,sample:support.sample,terrain:bounds=>[...outerSupport.projectedTriangles(bounds),...villageSupport.projectedTriangles(bounds)],limit:REALISTIC_TREE_COHORT_LIMIT-(realisticTrees?.ids.length??0)}):undefined;
 const scannedShrubs=input.scannedShrubSource?qualifyScannedShrubCohort({placements,source:input.scannedShrubSource,geography:g,village:v,landmarks,
  footprint(x,z,radius){const bounds={minX:x-radius,maxX:x+radius,minZ:z-radius,maxZ:z+radius};return scannedShrubFootprint([...outerSupport.projectedTriangles(bounds),...villageSupport.projectedTriangles(bounds)],x,z,radius);}}):undefined;
 return{version:POLICY.version,realisticTrees,realisticForest01Trees,scannedShrubs,naturalRiparian,villageFootprint:v,treeCount:maximum,shrubCount:shrubs,placements,rocks:Float32Array.from(rocks),groundcover:Float32Array.from(grass),groundcoverVersion:REGIONAL_GROUNDCOVER_PLACEMENT_VERSION,groundcoverRiparian,groundcoverDiagnostics,cells:[...cells].map(([id,c])=>({id,x:c.x,z:c.z,ids:Uint32Array.from(c.ids)})),landmarks,attempts,rejected,species};
}
