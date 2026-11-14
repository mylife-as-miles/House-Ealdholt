/** Person-bound ordinary work access. The original graph and place registry
 * remain unchanged; only an actual owned journey may use this private branch. */
import {copyObserverJSON} from '../observer/observer-json';
import {placeDataArray,placeDataRecord} from '../place-use';
import {parseVillageSiteEmergencyRefuges,validateVillageSiteEmergencyRefuges,deriveVillageRefugeBody,requiredVillageRefugeMotionClips,type VillageSiteEmergencyRefuge} from './village-emergency-refuges';
import {POPULATION_NEUTRAL_MINIMUM_BODY_Y_METRES} from './population-motion-clearance';
import {EALDHOLT_VILLAGE_POPULATION} from './village-population';
import {resolveVillageSiteEndpoint,type VillageSiteLayout,type VillageSitePoint,type VillageSiteRoute} from './village-site';

export interface VillageSiteWorkplaceRoute extends Omit<VillageSiteEmergencyRefuge,'proof'|'topology'> {
 readonly purpose?:'ordinary-workplace'|'community-timber';
 readonly proof:VillageSiteEmergencyRefuge['proof']&{readonly publicExteriorOnly:true};
 readonly topology:NonNullable<VillageSiteEmergencyRefuge['topology']>;
 /** A separately surveyed approach from this person's actual temporary refuge.
  * It exposes that one anchor, never the refuge's older connector or a home. */
 readonly recoveryApproach?:{readonly refugeId:string;readonly certificateSha256:string;readonly route:VillageSiteRoute};
}
export interface VillageWorkplaceRoutePermit {readonly residentId:string;readonly id:string;readonly certificateSha256:string}
export interface VillageWorkplaceRouteRef {readonly id:string;readonly certificateSha256:string;readonly returnPlaceId:string;readonly recoveryRefuge?:{readonly id:string;readonly certificateSha256:string}}
const trusted=new WeakSet<object>(),validated=new WeakMap<VillageSiteLayout,readonly VillageSiteWorkplaceRoute[]>();
const scopes=new WeakMap<VillageSiteLayout,Map<string,VillageSiteLayout>>(),bases=new WeakMap<VillageSiteLayout,VillageSiteLayout>();
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,191}$/u.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const same=(a:VillageSitePoint,b:VillageSitePoint)=>a.every((n,k)=>n===b[k]);
function freeze<T>(v:T):T{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;}
export {requiredVillageRefugeMotionClips as requiredVillageWorkplaceMotionClips};

export function parseVillageWorkplaceRouteRef(value:unknown):VillageWorkplaceRouteRef{
 const r=placeDataRecord(value,['id','certificateSha256','returnPlaceId'],['recoveryRefuge']);
 if(r.recoveryRefuge!==undefined){const pin=placeDataRecord(r.recoveryRefuge,['id','certificateSha256']);if(!id(pin.id)||!hash(pin.certificateSha256))throw Error('Invalid exact recovery refuge reference.');}
 if(!id(r.id)||!hash(r.certificateSha256)||!id(r.returnPlaceId))throw Error('Invalid source-bound ordinary workplace reference.');return value as VillageWorkplaceRouteRef;
}
export function parseVillageSiteWorkplaceRoutes(value:unknown):readonly VillageSiteWorkplaceRoute[]{
 if(value&&typeof value==='object'&&trusted.has(value))return value as readonly VillageSiteWorkplaceRoute[];
 const rows=copyObserverJSON(value)as readonly VillageSiteWorkplaceRoute[];if(placeDataArray(rows).length>128)throw Error('Ordinary workplace route budget exceeded.');
 const seen=new Set<string>(),people=new Set<string>();
 for(const row of rows){
  placeDataRecord(row,['id','residentId','placeId','anchorId','sourceActor','certificateSha256','body','proof','topology'],['purpose','recoveryApproach']);
  const person=EALDHOLT_VILLAGE_POPULATION.residents.find(r=>r.id===row.residentId);
  if(!person||row.purpose!==undefined&&!['ordinary-workplace','community-timber'].includes(row.purpose)
   ||(row.purpose==='community-timber'?(row.placeId!=='woodland-edge'||person.ageYears<18||person.ageYears>=60):row.placeId!==person.workPlaceId)
   ||row.placeId===person.homePlaceId||seen.has(row.id)||people.has(row.residentId))throw Error('Ordinary route may only serve its registered workplace or an explicit eligible community timber assignment.');
  seen.add(row.id);people.add(row.residentId);
  const proof=placeDataRecord(row.proof,['sourceSha256','profile','siteIdentity','sourceGroundPoint','capsuleBottomPoint','originalTriangleClearance','wholeFootprintSupported','sweptIdleAndWalkClear','motionEvidence','publicExteriorOnly']);
  if(proof.publicExteriorOnly!==true)throw Error('Ordinary work route must remain exterior.');
  const {publicExteriorOnly:_,...neutralProof}=row.proof,minimum=deriveVillageRefugeBody(row.proof.motionEvidence,row.residentId);
  // Reuse the strict published body/neutral clips/file pins and exact source
  // polyline parser. A declared conservative body may be larger than minimum,
  // but never smaller or less padded than any reachable neutral motion.
  const {purpose:_purpose,recoveryApproach:_recovery,...neutralRow}=row;parseVillageSiteEmergencyRefuges([{...neutralRow,body:minimum,proof:neutralProof}]);
  if(row.recoveryApproach){const recovery=placeDataRecord(row.recoveryApproach,['refugeId','certificateSha256','route']);
   if(row.purpose!=='community-timber'||!id(recovery.refugeId)||!hash(recovery.certificateSha256)||row.recoveryApproach.route.id===row.topology.route.id)throw Error('Recovery work needs its explicit private community source.');
   parseVillageSiteEmergencyRefuges([{...neutralRow,body:minimum,proof:neutralProof,topology:{anchor:row.topology.anchor,route:row.recoveryApproach.route}}]);
  }
  const body=placeDataRecord(row.body,['radius','height','margin','lift','zeroCrossfade']);
  if(typeof body.radius!=='number'||!Number.isFinite(body.radius)||body.radius<minimum.radius||typeof body.height!=='number'||!Number.isFinite(body.height)||body.height<minimum.height
   ||body.margin!==.005||body.lift!==.02||body.zeroCrossfade!==true)throw Error('Ordinary work route body undercuts measured neutral motion.');
  for(const level of Object.values(row.proof.motionEvidence.residents[row.residentId].levels))for(const clip of Object.values(level!.clips))if(clip.placedBelowGround||clip.minimumBodyYMetres<POPULATION_NEUTRAL_MINIMUM_BODY_Y_METRES)throw Error('Ordinary work route has unsupported neutral floor motion.');
 }
 freeze(rows);trusted.add(rows);return rows;
}
export function baseVillageWorkplaceRouteSite(site:VillageSiteLayout):VillageSiteLayout{return bases.get(site)??site;}
export function validateVillageSiteWorkplaceRoutes(value:VillageSiteLayout):readonly VillageSiteWorkplaceRoute[]{
 const site=baseVillageWorkplaceRouteSite(value),cached=validated.get(site);if(cached)return cached;
 const rows=parseVillageSiteWorkplaceRoutes(site.workplaceRoutes??[]);
 for(const row of rows){const a=row.topology.anchor,route=row.topology.route,from=site.anchors.find(a=>a.id===route.from);
  if(row.proof.profile!==site.profile||row.proof.sourceSha256!==site.sourceSha256||row.body.radius+row.body.margin>site.capsule.radius||row.body.height+row.body.lift+row.body.margin>site.capsule.height
   ||!from||site.anchors.some(a=>a.id===row.anchorId)||site.routes.some(r=>r.id===route.id)||resolveVillageSiteEndpoint(site,row.placeId,row.residentId)
   ||!same(route.sourceGroundPolyline[0],from.sourceGroundPoint)||!same(route.capsuleBottomPolyline[0],from.capsuleBottomPoint)
   ||a.id!==row.anchorId||!same(a.sourceGroundPoint,row.proof.sourceGroundPoint))throw Error('Ordinary workplace route changed an original binding, body or graph endpoint.');
  if(row.recoveryApproach){const recovery=row.recoveryApproach,refuge=validateVillageSiteEmergencyRefuges(site).find(r=>r.id===recovery.refugeId&&r.residentId===row.residentId&&r.certificateSha256===recovery.certificateSha256),origin=refuge&&(refuge.topology?.anchor??site.anchors.find(a=>a.id===refuge.anchorId));
   if(!refuge||!origin||site.anchors.some(a=>a.id===origin.id)||refuge.proof.siteIdentity!==row.proof.siteIdentity||recovery.route.from!==origin.id||site.routes.some(r=>r.id===recovery.route.id)
    ||!same(recovery.route.sourceGroundPolyline[0],origin.sourceGroundPoint)||!same(recovery.route.capsuleBottomPolyline[0],origin.capsuleBottomPoint))throw Error('Recovery work lost its exact same-person source refuge.');
  }
 }
 validated.set(site,rows);return rows;
}
export function findVillageWorkplaceRoute(site:VillageSiteLayout,ref:Pick<VillageWorkplaceRouteRef,'id'|'certificateSha256'>,residentId:string):VillageSiteWorkplaceRoute|null{
 return validateVillageSiteWorkplaceRoutes(baseVillageWorkplaceRouteSite(site)).find(row=>row.id===ref.id&&row.certificateSha256===ref.certificateSha256&&row.residentId===residentId)??null;
}
export function scopedVillageWorkplaceRouteSite(value:VillageSiteLayout,ref:VillageWorkplaceRouteRef,residentId:string):VillageSiteLayout|null{
 parseVillageWorkplaceRouteRef(ref);const site=baseVillageWorkplaceRouteSite(value),row=findVillageWorkplaceRoute(site,ref,residentId);if(!row)return null;
 const recovery=ref.recoveryRefuge&&row.recoveryApproach,refuge=recovery&&validateVillageSiteEmergencyRefuges(site).find(r=>r.id===recovery.refugeId&&r.residentId===residentId&&r.certificateSha256===recovery.certificateSha256),origin=refuge&&(refuge.topology?.anchor??site.anchors.find(a=>a.id===refuge.anchorId));
 if(ref.recoveryRefuge?(!recovery||!refuge||!origin||ref.recoveryRefuge.id!==recovery.refugeId||ref.recoveryRefuge.certificateSha256!==recovery.certificateSha256||ref.returnPlaceId!==refuge.placeId):!resolveVillageSiteEndpoint(site,ref.returnPlaceId,residentId))return null;
 let cache=scopes.get(site);if(!cache){cache=new Map();scopes.set(site,cache);}const key=residentId+'\0'+ref.id+'\0'+ref.returnPlaceId+'\0'+(ref.recoveryRefuge?.certificateSha256??''),old=cache.get(key);if(old)return old;
 const bindings=site.residentPlaceBindings.filter(binding=>binding.residentId!==residentId||binding.placeId!==row.placeId);
 bindings.push(Object.freeze({residentId,placeId:row.placeId,anchorId:row.anchorId,status:'mapped-exterior' as const}));
 if(refuge&&origin)bindings.push(Object.freeze({residentId,placeId:refuge.placeId,anchorId:origin.id,status:'mapped-exterior' as const}));
 const scoped=Object.freeze({...site,capsule:Object.freeze({radius:row.body.radius+row.body.margin,height:row.body.height+row.body.lift+row.body.margin}),
  anchors:Object.freeze([...site.anchors,row.topology.anchor,...(origin?[origin]:[])]),routes:Object.freeze([...site.routes,row.topology.route,...(recovery?[recovery.route]:[])]),residentPlaceBindings:Object.freeze(bindings)});
 bases.set(scoped,site);cache.set(key,scoped);return scoped;
}
function normalized(value:unknown):unknown{if(Array.isArray(value))return value.map(normalized);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,normalized(v)]));return value;}
export function sameVillageSiteWorkplaceRoute(a:VillageSiteWorkplaceRoute,b:VillageSiteWorkplaceRoute):boolean{return a===b||JSON.stringify(normalized(a))===JSON.stringify(normalized(b));}
