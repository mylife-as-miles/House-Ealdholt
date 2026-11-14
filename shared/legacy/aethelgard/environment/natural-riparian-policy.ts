import{NATURAL_RIPARIAN_DATA}from'./natural-riparian-asset-data';
import{maximumWaterStage,regionalShoreClearance}from'./regional-riparian-groundcover';
import{REGIONAL_RIPARIAN_GROUNDCOVER as POLICY}from'./regional-groundcover-policy';
import type{EaldholtFarGeography}from'./far-surround';
export const NATURAL_RIPARIAN_COHORT_VERSION='source-qualified-natural-bank-cohort-v1';
export{NATURAL_RIPARIAN_ASSET_PATH,NATURAL_RIPARIAN_NATIVE_ASSET_ID}from'./natural-riparian-manifest';
export type NaturalRiparianProfile='desktop'|'native';
export interface NaturalRiparianPlant{variant:string;height:number;minimumY:number;maximumY:number;radius:number;triangles:number;vertices:number}
export interface NaturalRiparianSource{version:string;profile:NaturalRiparianProfile;sourceSha256:string;plants:NaturalRiparianPlant[]}
export interface NaturalRiparianCohort{version:typeof NATURAL_RIPARIAN_COHORT_VERSION;sourceSha256:string;sourceContract:string;ids:Uint32Array;families:Uint8Array;examined:number;rejected:Record<string,number>}
export const naturalRiparianReservation=(native=false)=>(native?2:6)*1024**2;
export const naturalRiparianLimit=(native=false)=>native?6:24;
export const naturalRiparianAsset=(native=false)=>NATURAL_RIPARIAN_DATA.profiles[native?'native':'desktop'];
export function naturalRiparianSource(native=false):NaturalRiparianSource{
 const source=naturalRiparianAsset(native);return{version:NATURAL_RIPARIAN_COHORT_VERSION,profile:native?'native':'desktop',sourceSha256:source.sha256,plants:source.identity.plants.map(p=>({variant:p.variant,height:p.height,minimumY:p.minimumY,maximumY:p.maximumY,radius:p.radius,triangles:p.triangles,vertices:p.vertices}))};
}
export const naturalRiparianContract=(source:NaturalRiparianSource)=>JSON.stringify(source);
export function validNaturalRiparianSource(source:NaturalRiparianSource):boolean{
 return !!source&&['desktop','native'].includes(source.profile)&&naturalRiparianContract(source)===naturalRiparianContract(naturalRiparianSource(source.profile==='native'));
}
type Footprint={height:number;minimumHeight:number;maximumHeight:number;slope:number};
const outside=(r:EaldholtFarGeography['sourceEnvelope'],x:number,z:number)=>Math.hypot(Math.max(r.minX-x,0,x-r.maxX),Math.max(r.minZ-z,0,z-r.maxZ));
/** Qualifies visual substitutions at existing immutable grass centres. The
 * original rows, source identities and all solid/navigation data stay intact. */
export function qualifyNaturalRiparianCohort(input:{source:NaturalRiparianSource;grass:Float32Array;riparian:number;geography:EaldholtFarGeography;village:EaldholtFarGeography['sourceEnvelope'];fixtures:readonly{x:number;z:number;radius:number}[];footprint(x:number,z:number,radius:number):Footprint|null}):NaturalRiparianCohort{
 const{source,grass:p,geography:g}=input,ids:number[]=[],families:number[]=[],rejected:Record<string,number>={};let examined=0;
 if(!validNaturalRiparianSource(source)||p.length%6||p.length/6>8192||!Number.isSafeInteger(input.riparian)||input.riparian<0||input.riparian>Math.floor(p.length/6*POLICY.maximumFraction))throw Error('Unqualified natural plant source or grass cohort.');
 const reject=(reason:string)=>rejected[reason]=(rejected[reason]??0)+1;
 for(let id=p.length/6-input.riparian;id<p.length/6;id++){
  examined++;const at=id*6,x=p[at],base=p[at+1]+.004,z=p[at+2],family=id%3===0?0:1,plant=source.plants[family],wind=plant.height*.11,envelope=plant.radius+wind;
  if(!Array.from(p.subarray(at,at+6)).every(Number.isFinite)||p[at+4]<=0){reject('invalid-row');continue;}
  if(outside(g.sourceEnvelope,x,z)<5+envelope||outside(input.village,x,z)<5+envelope){reject('authored-source-or-village-envelope');continue;}
  if(regionalShoreClearance(g,x,z)<envelope+POLICY.minimumDryMarginMetres){reject('water-wind-envelope');continue;}
  const support=input.footprint(x,z,plant.radius+.001);
  if(!support||![support.height,support.minimumHeight,support.maximumHeight,support.slope].every(Number.isFinite)||support.maximumHeight<support.minimumHeight){reject('unsupported-or-overlapping-footprint');continue;}
  if(support.slope>POLICY.maximumSlope){reject('terrain-slope');continue;}
  if(base>support.minimumHeight+1e-5){reject('floating-contact');continue;}
  if(Math.min(base,support.minimumHeight)<maximumWaterStage(g,x-envelope,x+envelope)+POLICY.minimumDryMarginMetres){reject('low-wet-bank');continue;}
  const burial=support.maximumHeight-base;
  if(burial>Math.min(POLICY.maximumBurialMetres,plant.height*POLICY.maximumBurialFraction)+1e-5||plant.height-burial<POLICY.minimumExposedHeightMetres){reject('excess-soil-burial');continue;}
  if(input.fixtures.some(f=>Math.hypot(f.x-x,f.z-z)<f.radius+envelope+.1)){reject('root-rock-landmark-or-path-envelope');continue;}
  ids.push(id);families.push(family);
 }
 return{version:NATURAL_RIPARIAN_COHORT_VERSION,sourceSha256:source.sourceSha256,sourceContract:naturalRiparianContract(source),ids:Uint32Array.from(ids),families:Uint8Array.from(families),examined,rejected};
}
