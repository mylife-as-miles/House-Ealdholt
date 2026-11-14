import {FOREST01_DENSITY_WALKING} from './forest01-density-walking-data';
import {FOREST01_DENSITY_LOD,validForest01DensityWalkingProof,type Forest01DensityWalkingProof} from './forest01-density-lod';
import {realisticTreeWalkingClearance,REALISTIC_TREE_WALKING_VERSION,type WalkingBounds,type WalkingTerrainTriangle} from './realistic-tree-walking';
import type {VegetationRootContact,RootTerrainSupport} from './vegetation-root-contact';
import {REGIONAL_ROOT_CONTACTS} from './regional-root-contact-data';
import {REGIONAL_VEGETATION_PROTOTYPES} from './regional-assets';

export const REALISTIC_TREE_COHORT_VERSION='ealdholt-complete-alder-near-v1';
export const REALISTIC_TREE_COHORT_LIMIT=128;
export const REALISTIC_TREE_COHORT_DISTANCE=180;
export interface RealisticTreeCohortSource {readonly variant:1|2;readonly height:number;readonly canopyRadius:number;readonly contact:VegetationRootContact;readonly sourceSha256:string;readonly walkingTriangles:Float64Array;readonly densityWalking?:Forest01DensityWalkingProof}
export interface RealisticTreeCohort {readonly version:typeof REALISTIC_TREE_COHORT_VERSION;readonly sourceSha256:string;readonly ids:Uint32Array;readonly examined:number;readonly rejectedRoot:number;readonly rejectedWalking?:number;readonly heldWalkingUncertain?:number;readonly walkingGuardVersion?:string;readonly density?:{readonly version:string;readonly walkingGuardVersion:string;readonly proofSha256:string;readonly proofTriangles:number;readonly producer:string;readonly normalization:readonly number[];readonly ids:Uint32Array;readonly rejected:number;readonly uncertain:number}}

/** Qualify the new wood footprint at the existing immutable actor Y. A
 * replacement may not float, exceed the original foot envelope, or conceal a
 * slope mismatch by burying the new trunk beyond its measured collar budget. */
export function realisticTreeRootFits(input:{x:number;y:number;z:number;yaw:number;scale:number;source:RealisticTreeCohortSource;sample(x:number,z:number):RootTerrainSupport|null}):boolean{
 const {x,y,z,yaw,scale,source,sample}=input,contact=source.contact;
 const centre=sample(x,z);if(!centre||centre.slope>.72||!Number.isFinite(centre.height))return false;
 const burial=centre.height-contact.baseY*scale-y;
 const budget=Math.min(2,Math.max(.18,source.height*scale*.13),.18+contact.radius*scale*.8);
 if(burial<.015-1e-4||burial>budget+1e-4)return false;
 const c=Math.cos(yaw),s=Math.sin(yaw);
 for(const [px,py,pz] of contact.points){const support=sample(x+(px*c+pz*s)*scale,z+(-px*s+pz*c)*scale);
  if(!support||!Number.isFinite(support.height)||!Number.isFinite(support.slope)||support.slope>.72||y+py*scale>support.height-.015+1e-4)return false;
 }
 return true;
}

/** Runs after the original placement stream. Never consumes its random numbers
 * or changes its buffers/version. The small fixed cohort keeps species variety
 * elsewhere; every failure retains that actor's original complete visual. */
export function qualifyRealisticTreeCohort(input:{placements:Float32Array;source:RealisticTreeCohortSource;village:{minX:number;maxX:number;minZ:number;maxZ:number};sample(x:number,z:number):RootTerrainSupport|null;terrain?(bounds:WalkingBounds):readonly WalkingTerrainTriangle[];limit?:number}):RealisticTreeCohort{
 const {placements:p,source,village:v}=input;if(source.variant!==1&&source.variant!==2)throw Error('Unqualified complete-tree envelope.');
 const prototype=REGIONAL_VEGETATION_PROTOTYPES[source.variant],old=REGIONAL_ROOT_CONTACTS[prototype.id],contact=source.contact;
 if(!/^([a-f0-9]{64})$/.test(source.sourceSha256)||![source.height,source.canopyRadius,contact.baseY,contact.radius].every(Number.isFinite)||source.height<=0||source.canopyRadius<=0||contact.radius<=0||source.height>prototype.height+1e-6||source.height<prototype.height*.85||source.canopyRadius>prototype.canopyRadius+1e-6||contact.radius>old.radius+1e-6||Math.abs(contact.baseY-old.baseY)>1e-6||contact.points.length<3||contact.points.length>64||contact.points.some(point=>point.length!==3||!point.every(Number.isFinite)))throw Error('Unqualified complete-tree envelope.');
 if(!(source.walkingTriangles instanceof Float64Array)||source.walkingTriangles.length%9||source.walkingTriangles.length>9883*9||!source.walkingTriangles.every(Number.isFinite))throw Error('Unqualified complete-tree walking geometry.');
 const limit=input.limit??REALISTIC_TREE_COHORT_LIMIT;if(!Number.isInteger(limit)||limit<0||limit>REALISTIC_TREE_COHORT_LIMIT)throw Error('Invalid complete-tree cohort budget.');
 const candidates:{id:number;distance:number}[]=[];
 for(let id=0;id<p.length/6;id++){const at=id*6;if(p[at+5]!==source.variant)continue;
  const distance=Math.hypot(Math.max(v.minX-p[at],0,p[at]-v.maxX),Math.max(v.minZ-p[at+2],0,p[at+2]-v.maxZ));
  if(distance<=REALISTIC_TREE_COHORT_DISTANCE)candidates.push({id,distance});
 }
 candidates.sort((a,b)=>a.distance-b.distance||a.id-b.id);const ids:number[]=[];let examined=0,rejectedRoot=0,rejectedWalking=0,heldWalkingUncertain=0;
 for(const {id}of candidates){if(ids.length>=limit)break;examined++;const at=id*6;
  if(!realisticTreeRootFits({x:p[at],y:p[at+1],z:p[at+2],yaw:p[at+3],scale:p[at+4],source,sample:input.sample})){rejectedRoot++;continue;}
  const walking=realisticTreeWalkingClearance({x:p[at],y:p[at+1],z:p[at+2],yaw:p[at+3],scale:p[at+4],reservedRadius:old.radius,triangles:source.walkingTriangles,sample:input.sample,terrain:input.terrain});
  if(walking==='clear')ids.push(id);else{rejectedWalking++;if(walking==='uncertain')heldWalkingUncertain++;}
 }
 let density:RealisticTreeCohort['density'];const proof=source.densityWalking;
 if(source.variant===1&&source.sourceSha256===FOREST01_DENSITY_LOD.sourceSha256&&validForest01DensityWalkingProof(proof)&&proof){
  const qualified:number[]=[];let rejected=0,uncertain=0;
  for(const id of ids){const at=id*6,result=realisticTreeWalkingClearance({x:p[at],y:p[at+1],z:p[at+2],yaw:p[at+3],scale:p[at+4],reservedRadius:old.radius,triangles:proof.triangles,sample:input.sample,terrain:input.terrain});
   if(result==='clear')qualified.push(id);else{rejected++;if(result==='uncertain')uncertain++;}
  }
  density={version:FOREST01_DENSITY_LOD.version,walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,proofSha256:FOREST01_DENSITY_WALKING.sha256,proofTriangles:FOREST01_DENSITY_WALKING.triangles,producer:proof.producer,normalization:proof.normalization.slice(),ids:Uint32Array.from(qualified),rejected,uncertain};
 }
 return{version:REALISTIC_TREE_COHORT_VERSION,sourceSha256:source.sourceSha256,ids:Uint32Array.from(ids),examined,rejectedRoot,rejectedWalking,heldWalkingUncertain,walkingGuardVersion:REALISTIC_TREE_WALKING_VERSION,...(density?{density}:{})};
}
