/** Source-qualified temporary exterior refuges. Their aliases and supplemental
 * topology exist only inside an explicitly permitted resident's evacuation or
 * actual return journey, never in canonical household/ordinary navigation. */
import {copyObserverJSON} from '../observer/observer-json';
import {placeDataArray,placeDataRecord} from '../place-use';
import {parsePopulationMotionEvidence,POPULATION_NEUTRAL_MINIMUM_BODY_Y_METRES,requiredPopulationMotionFiles,availablePopulationMotionClipNames,type PopulationMotionEvidence} from './population-motion-clearance';
import {EALDHOLT_POPULATION_ASSET_SHA256} from './population-asset-integrity';
import {getPopulationArt} from './village-population-art';
import {getHouseholdArtSet} from './household-art-sets';
import type {VillageSiteLayout,VillageSiteAnchor,VillageSiteRoute,VillageSitePoint} from './village-site';

export interface VillageSiteEmergencyRefuge {
 readonly id:string;readonly residentId:string;readonly placeId:string;readonly anchorId:string;readonly sourceActor:string;readonly certificateSha256:string;
 readonly proof:{readonly sourceSha256:string;readonly profile:'desktop'|'quest';readonly siteIdentity:string;
  readonly sourceGroundPoint:VillageSitePoint;readonly capsuleBottomPoint:VillageSitePoint;
  readonly originalTriangleClearance:true;readonly wholeFootprintSupported:true;readonly sweptIdleAndWalkClear:true;
  readonly motionEvidence:PopulationMotionEvidence};
 readonly body:{readonly radius:number;readonly height:number;readonly margin:.005;readonly lift:.02;readonly zeroCrossfade:true};
 readonly topology?:{readonly anchor:VillageSiteAnchor;readonly route:VillageSiteRoute};
}
export interface VillageEmergencyRefugeRef {readonly ids:readonly string[];readonly certificates?:Readonly<Record<string,string>>}
export interface VillageEmergencyRefugePermit extends VillageEmergencyRefugeRef {readonly residentId:string}
const trusted=new WeakSet<object>(),validated=new WeakMap<VillageSiteLayout,readonly VillageSiteEmergencyRefuge[]>();
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,191}$/u.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const point=(v:unknown):v is VillageSitePoint=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
const samePoint=(a:VillageSitePoint,b:VillageSitePoint)=>a.every((n,k)=>n===b[k]);
function freeze<T>(v:T):T{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
export function requiredVillageRefugeMotionClips(residentId:string):readonly string[]{
 const art=getPopulationArt(residentId),household=getHouseholdArtSet(residentId);if(!art)return[];
 const idle=household?.actorMotions.idle??art.motions.idle,walk=household?.actorMotions.walk??art.motions.walk;
 const names=availablePopulationMotionClipNames(art);
 return Object.freeze([...new Set([idle,walk,...(household?[household.actorMotions.extra.start,household.actorMotions.extra.stop]:[`${walk}_start`,`${walk}_stop`].filter(name=>names.has(name)))].filter((name):name is string=>!!name))].sort());
}
export function deriveVillageRefugeBody(motion:PopulationMotionEvidence,residentId:string):VillageSiteEmergencyRefuge['body']{
 const levels=Object.values(motion.residents[residentId]?.levels??{}),clips=levels.flatMap(level=>Object.values(level!.clips));
 if(!clips.length)throw Error('Refuge body needs actual neutral motion samples.');
 return Object.freeze({radius:Math.max(...clips.map(c=>c.radiusMetres))+.05,height:Math.max(...clips.map(c=>c.heightMetres))+.05,margin:.005,lift:.02,zeroCrossfade:true});
}
function validateMotion(row:VillageSiteEmergencyRefuge):void{
 const art=getPopulationArt(row.residentId),motion=parsePopulationMotionEvidence(row.proof.motionEvidence),required=requiredVillageRefugeMotionClips(row.residentId);
 if(!art||!required.length||Object.keys(motion.residents).length!==1||!motion.residents[row.residentId])throw Error('Refuge motion must identify its exact published resident.');
 const levels=art.kind==='crowd'?['crowd']:row.proof.profile==='quest'?['quest']:['desktop-lod0','desktop-lod1'];
 const owned=motion.residents[row.residentId].levels;
 if(Object.keys(owned).length!==levels.length)throw Error('Refuge motion must include exactly the platform body levels.');
 for(const name of levels){const level=owned[name as keyof typeof owned];
  if(!level||Object.keys(level.clips).sort().join('|')!==required.join('|'))throw Error('Refuge motion lost a reachable neutral idle/walk transition.');
  const paths=requiredPopulationMotionFiles(art,name as 'crowd'|'desktop-lod0'|'desktop-lod1'|'quest');
  if(paths.some(path=>level.files[path]!==EALDHOLT_POPULATION_ASSET_SHA256[path]))throw Error('Refuge body, clip, metadata or worn-prop bytes changed.');
  for(const[path,sha]of Object.entries(level.files))if(EALDHOLT_POPULATION_ASSET_SHA256[path]!==sha)throw Error('Refuge motion references unpublished asset bytes.');
 }
}
export function parseVillageEmergencyRefugeRef(value:unknown):VillageEmergencyRefugeRef{
 const r=placeDataRecord(value,['ids'],['certificates']),ids=placeDataArray(r.ids);if(ids.length<1||ids.length>32||ids.some(v=>!id(v))||new Set(ids).size!==ids.length)throw Error('Invalid bounded source refuge references.');
 if(r.certificates!==undefined){const pins=placeDataRecord(r.certificates,Object.getOwnPropertyNames(r.certificates));if(Object.keys(pins).length!==ids.length||ids.some(id=>!hash(pins[id as string])))throw Error('Refuge references lost their exact certificate pins.');}
 return value as VillageEmergencyRefugeRef;
}
export function parseVillageSiteEmergencyRefuges(value:unknown):readonly VillageSiteEmergencyRefuge[]{
 if(value&&typeof value==='object'&&trusted.has(value))return value as readonly VillageSiteEmergencyRefuge[];
 const rows=copyObserverJSON(value)as readonly VillageSiteEmergencyRefuge[];if(placeDataArray(rows).length>1024)throw Error('Emergency refuge capability budget exceeded.');const ids=new Set<string>(),places=new Set<string>();
 for(const row of rows){placeDataRecord(row,['id','residentId','placeId','anchorId','sourceActor','certificateSha256','proof','body'],['topology']);
  const p=placeDataRecord(row.proof,['sourceSha256','profile','siteIdentity','sourceGroundPoint','capsuleBottomPoint','originalTriangleClearance','wholeFootprintSupported','sweptIdleAndWalkClear','motionEvidence']);
  const pair=`${row.residentId}\0${row.placeId}`;
  if(!id(row.id)||ids.has(row.id)||!id(row.residentId)||!id(row.placeId)||places.has(pair)||!id(row.anchorId)||typeof row.sourceActor!=='string'||!row.sourceActor||row.sourceActor.length>2048||!hash(row.certificateSha256)
   ||!hash(p.sourceSha256)||!['desktop','quest'].includes(p.profile as string)||typeof p.siteIdentity!=='string'||!p.siteIdentity||p.siteIdentity.length>2048||!point(p.sourceGroundPoint)||!point(p.capsuleBottomPoint)
   ||p.originalTriangleClearance!==true||p.wholeFootprintSupported!==true||p.sweptIdleAndWalkClear!==true)throw Error('Invalid exact source refuge declaration.');
  ids.add(row.id);places.add(pair);validateMotion(row);
  const body=placeDataRecord(row.body,['radius','height','margin','lift','zeroCrossfade']),derived=deriveVillageRefugeBody(row.proof.motionEvidence,row.residentId);
  if(body.radius!==derived.radius||body.height!==derived.height||body.margin!==.005||body.lift!==.02||body.zeroCrossfade!==true)throw Error('Refuge body changed its actual neutral motion envelope.');
  if(row.topology){const t=placeDataRecord(row.topology,['anchor','route']),a=placeDataRecord(t.anchor,['id','sourceActor','sourceGroundPoint','capsuleBottomPoint','standingOnly']),r=placeDataRecord(t.route,['id','from','to','reversible','sourceGroundPolyline','capsuleBottomPolyline','lengthMetres']);
   const g=placeDataArray(r.sourceGroundPolyline),b=placeDataArray(r.capsuleBottomPolyline);
   if(a.id!==row.anchorId||a.sourceActor!==row.sourceActor||a.standingOnly!==true||!point(a.sourceGroundPoint)||!point(a.capsuleBottomPoint)||!samePoint(a.sourceGroundPoint,row.proof.sourceGroundPoint)||!samePoint(a.capsuleBottomPoint,row.proof.capsuleBottomPoint)
    ||!id(r.id)||!id(r.from)||r.to!==a.id||r.from===r.to||r.reversible!==true||g.length<2||g.length>256||b.length!==g.length||g.some(v=>!point(v))||b.some(v=>!point(v))
    ||typeof r.lengthMetres!=='number'||!Number.isFinite(r.lengthMetres)||r.lengthMetres<=0||r.lengthMetres>1000)throw Error('Refuge supplemental geometry is incomplete.');
   const ground=g as readonly VillageSitePoint[],bottom=b as readonly VillageSitePoint[],length=ground.slice(1).reduce((n,q,i)=>n+Math.hypot(...q.map((v,k)=>v-ground[i][k])),0);
   if(Math.abs(length-r.lengthMetres)>1e-6||!samePoint(ground[ground.length-1],row.proof.sourceGroundPoint)||!samePoint(bottom[bottom.length-1],row.proof.capsuleBottomPoint)||ground.some((q,i)=>q[0]!==bottom[i][0]||q[2]!==bottom[i][2]||Math.abs(bottom[i][1]-q[1]-.02)>1e-8))throw Error('Refuge supplemental source/body arcs disagree.');
  }
 }
 freeze(rows);trusted.add(rows);return rows;
}
const scopes=new WeakMap<VillageSiteLayout,Map<string,VillageSiteLayout>>(),bases=new WeakMap<VillageSiteLayout,VillageSiteLayout>();
export function baseVillageEmergencyRefugeSite(site:VillageSiteLayout):VillageSiteLayout{return bases.get(site)??site;}
export function validateVillageSiteEmergencyRefuges(value:VillageSiteLayout):readonly VillageSiteEmergencyRefuge[]{
 const site=baseVillageEmergencyRefugeSite(value),old=validated.get(site);if(old)return old;
 const rows=parseVillageSiteEmergencyRefuges(site.emergencyRefuges??[]);
 for(const r of rows){const a=r.topology?.anchor??site.anchors.find(a=>a.id===r.anchorId),route=r.topology?.route;
  if(r.proof.sourceSha256!==site.sourceSha256||r.proof.profile!==site.profile||!a||a.sourceActor!==r.sourceActor||!samePoint(a.sourceGroundPoint,r.proof.sourceGroundPoint)||!samePoint(a.capsuleBottomPoint,r.proof.capsuleBottomPoint)
   ||site.placeBindings.some(b=>b.placeId===r.placeId)||site.residentPlaceBindings.some(b=>b.placeId===r.placeId&&(b.residentId!==r.residentId||b.anchorId!==r.anchorId||b.status!=='mapped-exterior')))throw Error('Refuge changed its original source or replaced an authored binding.');
  if(r.body.radius+r.body.margin>site.capsule.radius||r.body.height+r.body.lift+r.body.margin>site.capsule.height)throw Error('Refuge body exceeds the original connection capsule.');
  for(const level of Object.values(r.proof.motionEvidence.residents[r.residentId].levels))for(const clip of Object.values(level!.clips))if(clip.placedBelowGround||clip.minimumBodyYMetres<POPULATION_NEUTRAL_MINIMUM_BODY_Y_METRES)throw Error('Refuge neutral motion has unsupported floor samples.');
  if(route){const from=site.anchors.find(a=>a.id===route.from);if(!from||site.anchors.some(a=>a.id===r.anchorId)||site.routes.some(edge=>edge.id===route.id)||!samePoint(route.sourceGroundPolyline[0],from.sourceGroundPoint)||!samePoint(route.capsuleBottomPolyline[0],from.capsuleBottomPoint))throw Error('Refuge connector lost its exact original graph endpoint.');}
 }
 validated.set(site,rows);return rows;
}
function normalized(v:unknown):unknown {if(Array.isArray(v))return v.map(normalized);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,c])=>[k,normalized(c)]));return v;}
export function sameVillageSiteEmergencyRefuge(a:VillageSiteEmergencyRefuge,b:VillageSiteEmergencyRefuge):boolean{return a===b||JSON.stringify(normalized(a))===JSON.stringify(normalized(b));}
export function pinVillageEmergencyRefugeRef(site:VillageSiteLayout,ids:readonly string[],residentId:string):VillageEmergencyRefugeRef|null{
 const rows=validateVillageSiteEmergencyRefuges(site),pins:Record<string,string>={};for(const id of ids){const r=rows.find(r=>r.id===id&&r.residentId===residentId);if(!r)return null;pins[id]=r.certificateSha256;}return Object.freeze({ids:Object.freeze([...ids]),certificates:Object.freeze(pins)});
}
export function scopedVillageEmergencyRefugeSite(value:VillageSiteLayout,ref:VillageEmergencyRefugeRef,residentId:string):VillageSiteLayout|null{
 const input=placeDataRecord(ref,['ids'],['residentId','certificates']);if(input.residentId!==undefined&&input.residentId!==residentId)return null;
 const site=baseVillageEmergencyRefugeSite(value),refs=parseVillageEmergencyRefugeRef({ids:input.ids,...(input.certificates!==undefined?{certificates:input.certificates}:{})}),all=validateVillageSiteEmergencyRefuges(site),rows=[...refs.ids].sort().map(id=>all.find(r=>r.id===id&&r.residentId===residentId));if(rows.some(r=>!r||refs.certificates&&refs.certificates[r.id]!==r.certificateSha256))return null;
 let cache=scopes.get(site);if(!cache){cache=new Map();scopes.set(site,cache);}const key=residentId+'\0'+[...refs.ids].sort().join('\0'),old=cache.get(key);if(old)return old;
 const anchors=[...site.anchors],routes=[...site.routes],bindings=[...site.residentPlaceBindings],body=rows[0]!.body;
 if(rows.some(r=>r!.body.radius!==body.radius||r!.body.height!==body.height))throw Error('Refuge capabilities disagree about the same actual body.');
 for(const row of rows as VillageSiteEmergencyRefuge[]){if(row.topology){const a=anchors.find(a=>a.id===row.anchorId),edge=routes.find(edge=>edge.id===row.topology!.route.id);
   if(a&&!sameVillageSiteEmergencyRefuge({...row,topology:{anchor:a,route:row.topology.route}},row)||edge&&JSON.stringify(edge)!==JSON.stringify(row.topology.route))throw Error('Refuge supplemental capabilities conflict.');
   if(!a)anchors.push(row.topology.anchor);if(!edge)routes.push(row.topology.route);}
  if(!bindings.some(b=>b.residentId===residentId&&b.placeId===row.placeId))bindings.push(Object.freeze({residentId,placeId:row.placeId,anchorId:row.anchorId,status:'mapped-exterior' as const}));
 }
 const scoped=Object.freeze({...site,capsule:Object.freeze({radius:body.radius+body.margin,height:body.height+body.lift+body.margin}),anchors:Object.freeze(anchors),routes:Object.freeze(routes),residentPlaceBindings:Object.freeze(bindings)});bases.set(scoped,site);cache.set(key,scoped);return scoped;
}
/** A refuge must not consume an authored operational stand or the carrier's
 * complete swept corridor, including when that operation is not funded yet. */
export function villageRefugeClearOfOperations(point:VillageSitePoint,site:VillageSiteLayout,operations:readonly {readonly anchorId:string}[]=[]):boolean{
 const radius=site.capsule.radius,height=site.capsule.height;
 for(const t of [...site.emergencyTargets??[],...operations]){const anchor=site.anchors.find(a=>a.id===t.anchorId);if(anchor&&Math.abs(point[1]-anchor.sourceGroundPoint[1])<height&&Math.hypot(point[0]-anchor.sourceGroundPoint[0],point[2]-anchor.sourceGroundPoint[2])<2*radius-1e-7)return false;}
 for(const carry of site.emergencyTraversals??[]){
  const body=carry.body;for(const anchor of carry.topology?.anchors??[]){const p=anchor.sourceGroundPoint;if(point[1]<p[1]+body.height+body.lift+body.margin&&point[1]+height>p[1]&&Math.hypot(point[0]-p[0],point[2]-p[2])<radius+body.radius+body.margin-1e-7)return false;}
  for(const route of [carry,...carry.topology?.routes??[]])for(let i=1;i<route.sourceGroundPolyline.length;i++){
  const a=route.sourceGroundPolyline[i-1],b=route.sourceGroundPolyline[i];if(point[1]>=Math.max(a[1],b[1])+body.height+body.lift+body.margin||point[1]+height<=Math.min(a[1],b[1]))continue;
  const dx=b[0]-a[0],dz=b[2]-a[2],n=dx*dx+dz*dz,t=n?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[2]-a[2])*dz)/n)):0;
  if(Math.hypot(point[0]-a[0]-t*dx,point[2]-a[2]-t*dz)<radius+body.radius+body.margin-1e-7)return false;
 }}
 return true;
}
