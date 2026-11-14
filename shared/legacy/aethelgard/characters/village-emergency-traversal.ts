/** Exact source/actor/clip constrained traversal, separate from ordinary terrain
 * navigation and the canonical place registry. A source helper must certify it
 * against original triangles and terrain before attaching this capability. */
import {copyObserverJSON} from '../observer/observer-json';
import {placeDataArray,placeDataRecord} from '../place-use';
import {parsePopulationMotionEvidence,type PopulationMotionEvidence} from './population-motion-clearance';
import {deriveVillageRefugeBody,requiredVillageRefugeMotionClips} from './village-emergency-refuges';
import {EALDHOLT_POPULATION_ASSET_SHA256} from './population-asset-integrity';
import type {VillageSiteLayout,VillageSitePoint,VillageSiteAnchor,VillageSiteRoute,VillageSiteResidentPlaceBinding} from './village-site';
import {EALDHOLT_SWINE_CARRY_ROUTE_CANDIDATE} from './ealdholt-emergency-route-candidate';
import {EALDHOLT_BREWSTER_FIRE_RESPONSE_CANDIDATE} from './ealdholt-brewster-fire-response-candidate';
export interface VillageEmergencyNeutralReturn {
 readonly body:{readonly radius:number;readonly height:number;readonly margin:.005;readonly lift:.02;readonly zeroCrossfade:true};
 readonly motionEvidence:PopulationMotionEvidence;
 readonly originalTriangleClearance:true;readonly wholeFootprintSupported:true;readonly publicExteriorOnly:true;
}
export interface VillageSiteEmergencyTraversal {
 readonly id:string;readonly residentId:string;readonly profile:'desktop'|'quest';readonly sourceSha256:string;readonly siteIdentity:string;readonly certificateSha256:string;
 readonly fromAnchorId:string;readonly toAnchorId:string;readonly reversible:true;readonly requiredClip:'carry_bucket_walk';
 readonly sourceGroundPolyline:readonly VillageSitePoint[];readonly capsuleBottomPolyline:readonly VillageSitePoint[];readonly lengthMetres:number;
 readonly body:{readonly radius:number;readonly height:number;readonly margin:number;readonly lift:number};readonly files:Readonly<Record<string,string>>;
 readonly proof:{readonly sourceOriginalBuffersUnchanged:true;readonly originalTriangleClearance:true;readonly wholeFootprintSupported:true;readonly publicExteriorOnly:true;readonly carryLoopAndFixedPose0:true;readonly unmeasuredTransitions:false};
 /** Source-certified narrow action stands stay private to this exact carry
  * actor. They never become ordinary anchors, homes or registry places. */
 readonly neutralReturn?:VillageEmergencyNeutralReturn;
 readonly topology?:{readonly anchors:readonly VillageSiteAnchor[];readonly routes:readonly VillageSiteRoute[];readonly residentPlaceBindings:readonly VillageSiteResidentPlaceBinding[]};
}
export interface VillageEmergencyTraversalRef {readonly id:string;readonly certificateSha256:string;readonly requiredClip:'carry_bucket_walk'}
export interface VillageEmergencyLocomotionPermit extends VillageEmergencyTraversalRef {readonly residentId:string}
const trusted=new WeakSet<object>();
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=2048&&!/[\u0000-\u001f\u007f]/u.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function freeze<T>(v:T):T{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
function line(v:unknown):readonly VillageSitePoint[]{const rows=placeDataArray(v);if(rows.length<2||rows.length>4096||rows.some(p=>!Array.isArray(p)||p.length!==3||!p.every(finite)))throw Error('Emergency traversal needs bounded exact source polylines.');return rows as readonly VillageSitePoint[];}
function same(a:VillageSitePoint,b:VillageSitePoint):boolean{return a.every((n,k)=>n===b[k]);}
const carryProfiles=[EALDHOLT_SWINE_CARRY_ROUTE_CANDIDATE,EALDHOLT_BREWSTER_FIRE_RESPONSE_CANDIDATE]as const;
function topology(r:VillageSiteEmergencyTraversal):void{
 if(!r.topology)return;const t=placeDataRecord(r.topology,['anchors','routes','residentPlaceBindings']),anchors=placeDataArray(t.anchors),routes=placeDataArray(t.routes),bindings=placeDataArray(t.residentPlaceBindings),ids=new Set<string>(),edges=new Set<string>(),places=new Set<string>();
 if(!anchors.length||anchors.length>32||!routes.length||routes.length>64||!bindings.length||bindings.length>32)throw Error('Emergency action topology exceeds its finite budget.');
 for(const value of anchors){const a=placeDataRecord(value,['id','sourceActor','sourceGroundPoint','capsuleBottomPoint','standingOnly']);if(!id(a.id)||ids.has(a.id)||!id(a.sourceActor)||a.standingOnly!==true)throw Error('Invalid emergency action anchor.');const ground=line([a.sourceGroundPoint,a.sourceGroundPoint])[0],bottom=line([a.capsuleBottomPoint,a.capsuleBottomPoint])[0];if(ground[0]!==bottom[0]||ground[2]!==bottom[2]||Math.abs(bottom[1]-ground[1]-r.body.lift)>1e-8)throw Error('Emergency action anchor lost its exact floor lift.');ids.add(a.id);}
 for(const value of routes){const e=placeDataRecord(value,['id','from','to','reversible','sourceGroundPolyline','capsuleBottomPolyline','lengthMetres']),ground=line(e.sourceGroundPolyline),bottom=line(e.capsuleBottomPolyline);if(!id(e.id)||edges.has(e.id)||e.id===r.id||!id(e.from)||!id(e.to)||e.from===e.to||e.reversible!==true||!ids.has(e.from)&&!ids.has(e.to)||ground.length!==bottom.length||ground.some((p,i)=>p[0]!==bottom[i][0]||p[2]!==bottom[i][2]||Math.abs(bottom[i][1]-p[1]-r.body.lift)>1e-8))throw Error('Invalid emergency private action connector.');const length=ground.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-ground[i][k])),0);if(!finite(e.lengthMetres)||e.lengthMetres<=0||Math.abs(length-e.lengthMetres)>1e-6)throw Error('Emergency action connector length changed.');edges.add(e.id);}
 for(const value of bindings){const b=placeDataRecord(value,['residentId','placeId','anchorId','status']);if(b.residentId!==r.residentId||!id(b.placeId)||places.has(b.placeId)||!id(b.anchorId)||!ids.has(b.anchorId)||b.status!=='mapped-exterior')throw Error('Emergency private action binding belongs to another actor.');places.add(b.placeId);}
}
export function parseVillageSiteEmergencyTraversals(value:unknown):readonly VillageSiteEmergencyTraversal[]{
 if(value&&typeof value==='object'&&trusted.has(value))return value as readonly VillageSiteEmergencyTraversal[];
 const rows=copyObserverJSON(value)as readonly VillageSiteEmergencyTraversal[];if(placeDataArray(rows).length>16)throw Error('Emergency traversal capability budget exceeded.');const ids=new Set<string>();
 for(const r of rows){placeDataRecord(r,['id','residentId','profile','sourceSha256','siteIdentity','certificateSha256','fromAnchorId','toAnchorId','reversible','requiredClip','sourceGroundPolyline','capsuleBottomPolyline','lengthMetres','body','files','proof'],['topology','neutralReturn']);
  const b=placeDataRecord(r.body,['radius','height','margin','lift']),p=placeDataRecord(r.proof,['sourceOriginalBuffersUnchanged','originalTriangleClearance','wholeFootprintSupported','publicExteriorOnly','carryLoopAndFixedPose0','unmeasuredTransitions']);
  const profile=carryProfiles.find(p=>p.residentId===r.residentId);
  if(!id(r.id)||ids.has(r.id)||!profile||r.profile!=='desktop'||!hash(r.sourceSha256)||!id(r.siteIdentity)||!hash(r.certificateSha256)||!id(r.fromAnchorId)||!id(r.toAnchorId)||r.fromAnchorId===r.toAnchorId||r.reversible!==true||r.requiredClip!=='carry_bucket_walk'
   ||b.radius!==profile.body.radius||b.height!==profile.body.height||b.margin!==.005||b.lift!==.02||p.sourceOriginalBuffersUnchanged!==true||p.originalTriangleClearance!==true||p.wholeFootprintSupported!==true||p.publicExteriorOnly!==true||p.carryLoopAndFixedPose0!==true||p.unmeasuredTransitions!==false)throw Error('Emergency traversal changed its measured source/worker/carry contract.');ids.add(r.id);
  const ground=line(r.sourceGroundPolyline),bottom=line(r.capsuleBottomPolyline);if(ground.length!==bottom.length||ground.some((q,i)=>q[0]!==bottom[i][0]||q[2]!==bottom[i][2]||Math.abs(bottom[i][1]-q[1]-r.body.lift)>1e-8)||!finite(r.lengthMetres)||r.lengthMetres<=0||r.lengthMetres>1000)throw Error('Emergency traversal ground/body frames disagree.');
  const length=ground.slice(1).reduce((n,q,i)=>n+Math.hypot(...q.map((v,k)=>v-ground[i][k])),0);if(Math.abs(length-r.lengthMetres)>1e-6)throw Error('Emergency traversal length differs from its source arc.');
  const files=placeDataRecord(r.files,Object.getOwnPropertyNames(r.files)),required=Object.keys(profile.files).filter(path=>path===`crowd-v1/residents/${r.residentId}.glb`||path===`crowd-v1/residents/${r.residentId}.json`||path.startsWith('crowd-v1/clips/')||path==='crowd-v1/props/crowd-props-everyday-v1.glb');
  if(Object.keys(files).length>32||required.some(path=>files[path]!==EALDHOLT_POPULATION_ASSET_SHA256[path])||Object.entries(files).some(([path,sha])=>!hash(sha)||EALDHOLT_POPULATION_ASSET_SHA256[path]!==sha))throw Error('Emergency traversal body, clip or actual bucket source bytes changed.');
  if(r.neutralReturn){
   const n=placeDataRecord(r.neutralReturn,['body','motionEvidence','originalTriangleClearance','wholeFootprintSupported','publicExteriorOnly']),body=placeDataRecord(n.body,['radius','height','margin','lift','zeroCrossfade']),motion=parsePopulationMotionEvidence(n.motionEvidence),expected='neutralReturn'in profile?profile.neutralReturn:null,level=motion.residents[r.residentId]?.levels.crowd;
   if(!expected||n.originalTriangleClearance!==true||n.wholeFootprintSupported!==true||n.publicExteriorOnly!==true||motion.paddingMetres!==.05||Object.keys(motion.residents).join('|')!==r.residentId||!level||Object.keys(motion.residents[r.residentId].levels).join('|')!=='crowd'||Object.keys(level.clips).sort().join('|')!==requiredVillageRefugeMotionClips(r.residentId).join('|')||JSON.stringify(normalized(motion))!==JSON.stringify(normalized(expected.motionEvidence))||Object.entries(level.files).some(([p,sha])=>files[p]!==sha||EALDHOLT_POPULATION_ASSET_SHA256[p]!==sha)||Object.values(level.clips).some(c=>c.placedBelowGround||c.minimumBodyYMetres<-.005))throw Error('Neutral carry return lost its exact actor, neutral clips or source files.');
   const derived=deriveVillageRefugeBody(motion,r.residentId);if(JSON.stringify(normalized(body))!==JSON.stringify(normalized(derived)))throw Error('Neutral carry return changed its measured body.');
  }
  topology(r);
 }
 freeze(rows);trusted.add(rows);return rows;
}
export function validateVillageSiteEmergencyTraversals(site:VillageSiteLayout):readonly VillageSiteEmergencyTraversal[]{
 site=baseVillageEmergencyTraversalSite(site);
 const routes=parseVillageSiteEmergencyTraversals(site.emergencyTraversals??[]);
 for(const r of routes){if(r.neutralReturn&&(r.neutralReturn.body.radius+r.neutralReturn.body.margin>site.capsule.radius||r.neutralReturn.body.height+r.neutralReturn.body.lift+r.neutralReturn.body.margin>site.capsule.height))throw Error('Original source graph cannot contain the measured neutral return body.');const a=site.anchors.find(a=>a.id===r.fromAnchorId),b=site.anchors.find(a=>a.id===r.toAnchorId);
  if(r.profile!==site.profile||r.sourceSha256!==site.sourceSha256||!a||!b||site.routes.some(edge=>edge.id===r.id)||!same(r.sourceGroundPolyline[0],a.sourceGroundPoint)||!same(r.sourceGroundPolyline[r.sourceGroundPolyline.length-1],b.sourceGroundPoint)||!same(r.capsuleBottomPolyline[0],a.capsuleBottomPoint)||!same(r.capsuleBottomPolyline[r.capsuleBottomPolyline.length-1],b.capsuleBottomPoint))throw Error('Emergency traversal changed the original source anchors/graph.');
  if(r.topology){const all=new Map(site.anchors.map(a=>[a.id,a]));for(const anchor of r.topology.anchors){if(all.has(anchor.id))throw Error('Emergency action topology replaces an original anchor.');all.set(anchor.id,anchor);}for(const route of r.topology.routes){const from=all.get(route.from),to=all.get(route.to);if(!from||!to||site.routes.some(e=>e.id===route.id)||!same(route.sourceGroundPolyline[0],from.sourceGroundPoint)||!same(route.sourceGroundPolyline[route.sourceGroundPolyline.length-1],to.sourceGroundPoint)||!same(route.capsuleBottomPolyline[0],from.capsuleBottomPoint)||!same(route.capsuleBottomPolyline[route.capsuleBottomPolyline.length-1],to.capsuleBottomPoint))throw Error('Emergency action connector changed its original source endpoints.');}for(const binding of r.topology.residentPlaceBindings)if(site.placeBindings.some(b=>b.placeId===binding.placeId)||site.residentPlaceBindings.some(b=>b.placeId===binding.placeId))throw Error('Emergency action binding replaces an existing place.');}
 }
 return routes;
}
function normalized(v:unknown):unknown {if(Array.isArray(v))return v.map(normalized);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,c])=>[k,normalized(c)]));return v;}
export function sameVillageSiteEmergencyTraversal(a:VillageSiteEmergencyTraversal,b:VillageSiteEmergencyTraversal):boolean{return a===b||JSON.stringify(normalized(a))===JSON.stringify(normalized(b));}
export function findVillageEmergencyTraversal(site:VillageSiteLayout,ref:VillageEmergencyTraversalRef,residentId:string):VillageSiteEmergencyTraversal|null {
 return validateVillageSiteEmergencyTraversals(baseVillageEmergencyTraversalSite(site)).find(r=>r.id===ref.id&&r.certificateSha256===ref.certificateSha256&&r.requiredClip===ref.requiredClip&&r.residentId===residentId)??null;
}
const scopes=new WeakMap<VillageSiteLayout,Map<string,VillageSiteLayout>>(),bases=new WeakMap<VillageSiteLayout,VillageSiteLayout>();
export function baseVillageEmergencyTraversalSite(site:VillageSiteLayout):VillageSiteLayout{return bases.get(site)??site;}
/** Private scoped graph; never attached to canonical state or granted to peers. */
export function scopedVillageEmergencyTraversalSite(site:VillageSiteLayout,ref:VillageEmergencyTraversalRef,residentId:string):VillageSiteLayout|null {
 const base=baseVillageEmergencyTraversalSite(site),r=findVillageEmergencyTraversal(base,ref,residentId);if(!r)return null;let byRoute=scopes.get(base);if(!byRoute){byRoute=new Map();scopes.set(base,byRoute);}let scoped=byRoute.get(r.id);if(scoped)return scoped;
 const edge={id:r.id,from:r.fromAnchorId,to:r.toAnchorId,reversible:true as const,sourceGroundPolyline:r.sourceGroundPolyline,capsuleBottomPolyline:r.capsuleBottomPolyline,lengthMetres:r.lengthMetres};
 scoped=Object.freeze({...base,capsule:Object.freeze({radius:r.body.radius+r.body.margin,height:r.body.height+r.body.lift+r.body.margin}),anchors:r.topology?Object.freeze([...base.anchors,...r.topology.anchors]):base.anchors,routes:Object.freeze([...base.routes,edge,...(r.topology?.routes??[])]),residentPlaceBindings:r.topology?Object.freeze([...base.residentPlaceBindings,...r.topology.residentPlaceBindings]):base.residentPlaceBindings});bases.set(scoped,base);byRoute.set(r.id,scoped);return scoped;
}
