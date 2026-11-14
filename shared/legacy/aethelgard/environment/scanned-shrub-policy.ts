import type {RootTerrainSupport} from './vegetation-root-contact';
import {REGIONAL_ROOT_CONTACTS} from './regional-root-contact-data';
import {REGIONAL_VEGETATION_PROTOTYPES} from './regional-assets';
import {regionalShoreClearance} from './regional-riparian-groundcover';
import type {EaldholtFarGeography} from './far-surround';

/** Visual soft foliage only. These measurements never publish a solid shape,
 * navigation obstacle, workplace/road clearance or changed actor transform. */
export const SCANNED_SHRUB_COHORT_VERSION='ealdholt-shrub02-b-bramble-source-v1';
export const SCANNED_SHRUB_VARIANT=13 as const;
export const SCANNED_SHRUB_COHORT_LIMIT=256;
export const SCANNED_SHRUB_COHORT_DISTANCE=240;
export const scannedShrubDetailLimit=(native=false)=>native?2:4;
export const scannedShrubDerivativeBudget=(native=false)=>(native?4:8)*1024**2;
export interface ScannedShrubContact {
 readonly baseY:number;readonly radius:number;
 readonly points:readonly (readonly [number,number,number])[];
}
export interface ScannedShrubCohortSource {
 readonly variant:typeof SCANNED_SHRUB_VARIANT;readonly sourceSha256:string;
 readonly height:number;readonly canopyRadius:number;readonly windReach:number;
 readonly contact:ScannedShrubContact;
}
export interface ScannedShrubCohort {
 readonly version:typeof SCANNED_SHRUB_COHORT_VERSION;readonly sourceSha256:string;
 readonly sourceContract:string;
 readonly ids:Uint32Array;readonly examined:number;readonly rejectedRoot:number;
}
export type ScannedShrubSupport=(x:number,z:number)=>RootTerrainSupport|null;
export interface ScannedShrubFootprint {
 readonly height:number;readonly minimumHeight:number;readonly maximumHeight:number;readonly slope:number;
}
type TerrainTriangle={readonly vertices:readonly (readonly[number,number,number])[]};
const outside=(r:EaldholtFarGeography['sourceEnvelope'],x:number,z:number)=>Math.hypot(Math.max(r.minX-x,0,x-r.maxX),Math.max(r.minZ-z,0,z-r.maxZ));

/** A scan is accepted only inside the existing bramble's complete visual/root
 * envelope. The source remains at natural height; no large-tree substitution
 * or classification of the one-material leafy scan as hard wood is permitted. */
export function validScannedShrubSource(source:ScannedShrubCohortSource):boolean {
 const old=REGIONAL_VEGETATION_PROTOTYPES[SCANNED_SHRUB_VARIANT],foot=REGIONAL_ROOT_CONTACTS[old.id],c=source.contact;
 return source.variant===SCANNED_SHRUB_VARIANT&&/^[a-f0-9]{64}$/.test(source.sourceSha256)
  &&[source.height,source.canopyRadius,source.windReach,c?.baseY,c?.radius].every(Number.isFinite)
  &&source.height>=old.height*.85&&source.height<=old.height&&source.canopyRadius>0&&Math.abs(source.windReach-source.height*.018)<1e-7
  &&source.canopyRadius+source.windReach<=old.canopyRadius&&c.radius>0&&c.radius<=foot.radius&&Math.abs(c.baseY-foot.baseY)<1e-6
  &&Array.isArray(c.points)&&c.points.length>=3&&c.points.length<=64&&c.points.every(p=>p.length===3&&p.every(Number.isFinite)
   &&p[1]>=c.baseY-1e-6&&p[1]<=c.baseY+.0301&&Math.hypot(p[0],p[2])<=c.radius+1e-5);
}
export function scannedShrubSourceContract(source:ScannedShrubCohortSource):string {
 return JSON.stringify([SCANNED_SHRUB_COHORT_VERSION,source.variant,source.sourceSha256,source.height,source.canopyRadius,source.windReach,source.contact]);
}

/** Worker-only visual qualification over existing immutable IDs. A complete
 * contact disk must have one unambiguous actual support plane; vertex probes
 * alone cannot prove contact over holes or conflicting terrain. Source-envelope
  * and exact coast/channel clearance retain authored paths and dry shorelines. */
export function qualifyScannedShrubCohort(input:{
 placements:Float32Array;source:ScannedShrubCohortSource;geography:EaldholtFarGeography;
 village:EaldholtFarGeography['sourceEnvelope'];footprint(x:number,z:number,radius:number):ScannedShrubFootprint|null;
 landmarks?:readonly {x:number;z:number;radius:number}[];
}):ScannedShrubCohort {
 const {placements:p,source}=input;
 if(!validScannedShrubSource(source)||p.length%6)throw Error('Unqualified soft-shrub source or actor data.');
 const candidates:{id:number;distance:number}[]=[];
 for(let id=0;id<p.length/6;id++){const at=id*6;if(p[at+5]!==SCANNED_SHRUB_VARIANT)continue;
  const distance=outside(input.village,p[at],p[at+2]);if(distance<=SCANNED_SHRUB_COHORT_DISTANCE)candidates.push({id,distance});
 }
 candidates.sort((a,b)=>a.distance-b.distance||a.id-b.id);
 const ids:number[]=[];let examined=0,rejectedRoot=0;
 for(const {id}of candidates){if(ids.length>=SCANNED_SHRUB_COHORT_LIMIT)break;examined++;const at=id*6,[x,y,z,,scale]=p.subarray(at,at+5);
  const radius=(source.canopyRadius+source.windReach)*scale;
  if(![x,y,z,p[at+3],scale].every(Number.isFinite)||scale<=0||scale>2
    ||outside(input.village,x,z)<radius+3||regionalShoreClearance(input.geography,x,z)<radius+.35
    ||input.landmarks?.some(p=>Math.hypot(x-p.x,z-p.z)<p.radius+12+radius)){rejectedRoot++;continue;}
  const foot=input.footprint(x,z,source.contact.radius*scale+.001);
  // Use the complete measured bottom-band upper bound, including interior
  // vertices whose Y is not represented by the projected convex hull.
  const base=y+source.contact.baseY*scale,top=base+.03*scale;
  const budget=Math.min(.18,source.height*scale*.18);
  if(!foot||![foot.height,foot.minimumHeight,foot.maximumHeight,foot.slope].every(Number.isFinite)||foot.slope>.58
    ||foot.maximumHeight<foot.minimumHeight||top>foot.minimumHeight-.005+1e-5||foot.maximumHeight-base>budget+1e-5
    ||foot.minimumHeight-base<.005-1e-5){rejectedRoot++;continue;}
  ids.push(id);
 }
 return{version:SCANNED_SHRUB_COHORT_VERSION,sourceSha256:source.sourceSha256,sourceContract:scannedShrubSourceContract(source),ids:Uint32Array.from(ids),examined,rejectedRoot};
}

/** Conservative small contact disk over both original and generated surfaces.
 * One actual triangle must contain it, and every overlapping triangle must be
 * coplanar. Missing, steep, conflicting or boundary-straddling support is held;
 * the original bramble remains visible. No terrain/navigation output is made. */
export function scannedShrubFootprint(triangles:readonly TerrainTriangle[],x:number,z:number,radius:number):ScannedShrubFootprint|null {
 if(![x,z,radius].every(Number.isFinite)||radius<=0||radius>1||triangles.length>4096)return null;
 const segment=(a:readonly number[],b:readonly number[])=>{const dx=b[0]-a[0],dz=b[2]-a[2],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/l)):0;return Math.hypot(x-a[0]-t*dx,z-a[2]-t*dz);};
 const planes:{vertices:TerrainTriangle['vertices'];height:number;gx:number;gz:number;contains:boolean}[]=[];
 for(const {vertices:p}of triangles){
  if(p.length!==3||p.some(v=>v.length!==3||!v.every(Number.isFinite)))return null;
  const[a,b,c]=p,dx=b[0]-a[0],dz=b[2]-a[2],ex=c[0]-a[0],ez=c[2]-a[2],det=dx*ez-ex*dz;if(Math.abs(det)<1e-9)continue;
  const u=((x-a[0])*ez-(z-a[2])*ex)/det,v=(dx*(z-a[2])-dz*(x-a[0]))/det,inside=u>=0&&v>=0&&u+v<=1;
  const edge=Math.min(segment(a,b),segment(b,c),segment(c,a));if(!inside&&edge>radius)continue;
  const dy=b[1]-a[1],ey=c[1]-a[1],gx=(dy*ez-ey*dz)/det,gz=(dx*ey-ex*dy)/det;
  planes.push({vertices:p,height:a[1]+u*dy+v*ey,gx,gz,contains:inside&&edge>=radius+1e-5});
 }
 const plane=planes.find(p=>p.contains);if(!plane)return null;
 if(planes.some(p=>p.vertices.some(v=>Math.abs(v[1]-(plane.height+(v[0]-x)*plane.gx+(v[2]-z)*plane.gz))>2e-5)))return null;
 const slope=Math.hypot(plane.gx,plane.gz),variation=radius*slope;
 return{height:plane.height,minimumHeight:plane.height-variation,maximumHeight:plane.height+variation,slope};
}
