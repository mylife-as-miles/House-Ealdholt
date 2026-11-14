/** Source-qualified temporary action destinations. These do not become homes,
 * registry places, life reservations, or permission inferred from a name. */
import {copyObserverJSON} from '../observer/observer-json';
import {placeDataArray,placeDataRecord} from '../place-use';
import {resolveVillageSiteEndpoint,type VillageSiteLayout} from './village-site';
import {baseVillageEmergencyTraversalSite,scopedVillageEmergencyTraversalSite,validateVillageSiteEmergencyTraversals} from './village-emergency-traversal';
import type {ResidentBuildingEmergencyStation} from './resident-building-emergency';
export type VillageSiteEmergencyTarget=Omit<ResidentBuildingEmergencyStation,'disasterId'>;
const trusted=new WeakSet<object>();
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=2048&&!/[\u0000-\u001f\u007f]/u.test(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function freeze<T>(v:T):T {if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
export function parseVillageSiteEmergencyTargets(value:unknown):readonly VillageSiteEmergencyTarget[]{
 if(value&&typeof value==='object'&&trusted.has(value))return value as readonly VillageSiteEmergencyTarget[];
 const rows=copyObserverJSON(value)as readonly VillageSiteEmergencyTarget[];if(placeDataArray(rows).length>512)throw Error('Emergency action target capacity exceeded.');const seen=new Set<string>();
 for(const row of rows){placeDataRecord(row,['id','residentId','placeId','anchorId','kind','buildingKey','sourceActor','contactPoint','yawRadians','clip','operationWorldMinutes','waterUnits','proof']);
  const p=placeDataRecord(row.proof,['sourceSha256','profile','siteIdentity','originalTriangleClearance','wholeFootprintSupported','sweptClipAndPropsClear','contactSourceActor','maximumContactDistanceMetres','clip'],['contactKind','equipmentAssetPath','equipmentSha256']);
  const key=`${row.residentId}\0${row.placeId}`;
  if(!id(row.id)||!id(row.residentId)||!id(row.placeId)||!id(row.anchorId)||!id(row.sourceActor)||seen.has(key)||!['water','fire','repair'].includes(row.kind)
   ||row.kind==='water'&&row.buildingKey!==null||row.kind!=='water'&&!id(row.buildingKey)||!['idle','carry_bucket_walk','work_hammer_bench','work_chisel'].includes(row.clip)
   ||!Array.isArray(row.contactPoint)||row.contactPoint.length!==3||!row.contactPoint.every(finite)||!finite(row.yawRadians)
   ||!Number.isSafeInteger(row.operationWorldMinutes)||row.operationWorldMinutes<1||row.operationWorldMinutes>60||!Number.isSafeInteger(row.waterUnits)||row.waterUnits<1||row.waterUnits>1000
   ||typeof p.sourceSha256!=='string'||!/^([a-f0-9]{64})$/u.test(p.sourceSha256)||!['desktop','quest'].includes(p.profile as string)||!id(p.siteIdentity)
   ||p.originalTriangleClearance!==true||p.wholeFootprintSupported!==true||p.sweptClipAndPropsClear!==true||!id(p.contactSourceActor)||p.clip!==row.clip
   ||!finite(p.maximumContactDistanceMetres)||p.maximumContactDistanceMetres<=0||p.maximumContactDistanceMetres>4
   ||p.contactKind!==undefined&&p.contactKind!=='published-workpiece'||p.equipmentAssetPath!==undefined&&!id(p.equipmentAssetPath)||p.equipmentSha256!==undefined&&(typeof p.equipmentSha256!=='string'||!/^([a-f0-9]{64})$/u.test(p.equipmentSha256)))throw Error('Invalid source-qualified emergency action target.');seen.add(key);
 }
 freeze(rows);trusted.add(rows);return rows;
}
function normalized(v:unknown):unknown {if(Array.isArray(v))return v.map(normalized);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,c])=>[k,normalized(c)]));return v;}
/** Chrome/Node Math.atan2 can differ by one double ULP for the same source
 * direction. Permit at most 1e-12 radians in this derived orientation only.
 * Source IDs, positions, equipment, clip and proof fields remain byte-exact;
 * neither input nor its durable serialized yaw is normalized or rewritten. */
export function sameVillageSiteEmergencyTarget(a:VillageSiteEmergencyTarget,b:VillageSiteEmergencyTarget):boolean {
 if(!Number.isFinite(a.yawRadians)||!Number.isFinite(b.yawRadians)||Math.abs(a.yawRadians-b.yawRadians)>1e-12)return false;
 if(a===b)return true;
 const {yawRadians:ay,...af}=a,{yawRadians:by,...bf}=b;
 return JSON.stringify(normalized(af))===JSON.stringify(normalized(bf));
}
/** A frame must still supply the current incident and authorized work order.
 * This exact template proves only the static source destination/clip/equipment. */
export function matchesVillageSiteEmergencyStation(target:VillageSiteEmergencyTarget,station:ResidentBuildingEmergencyStation):boolean {
 const {disasterId:_,...template}=station;return sameVillageSiteEmergencyTarget(target,template);
}
/** Static source qualification may inspect the registered actor-specific stand.
 * Actual travel still needs that actor's explicit live locomotion permit. */
export function villageEmergencyTargetSourceSite(site:VillageSiteLayout,residentId:string,placeId:string):VillageSiteLayout|null{
 if(resolveVillageSiteEndpoint(site,placeId,residentId))return site;
 const base=baseVillageEmergencyTraversalSite(site),route=validateVillageSiteEmergencyTraversals(base).find(r=>r.residentId===residentId&&r.topology?.residentPlaceBindings.some(b=>b.residentId===residentId&&b.placeId===placeId));
 return route?scopedVillageEmergencyTraversalSite(base,{id:route.id,certificateSha256:route.certificateSha256,requiredClip:route.requiredClip},residentId):null;
}
export function validateVillageSiteEmergencyTargets(site:VillageSiteLayout):readonly VillageSiteEmergencyTarget[]{
 const targets=parseVillageSiteEmergencyTargets(site.emergencyTargets??[]),seen=new Set<string>();
 for(const t of targets){const scoped=villageEmergencyTargetSourceSite(site,t.residentId,t.placeId),endpoint=scoped&&resolveVillageSiteEndpoint(scoped,t.placeId,t.residentId),binding=scoped?.residentPlaceBindings.find(b=>b.residentId===t.residentId&&b.placeId===t.placeId);
  if(t.proof.sourceSha256!==site.sourceSha256||t.proof.profile!==site.profile||!endpoint||binding?.status!=='mapped-exterior'||binding.anchorId!==t.anchorId||endpoint.id!==t.anchorId||endpoint.sourceActor!==t.sourceActor||seen.has(t.id))throw Error('Emergency action target changed its certified source binding.');seen.add(t.id);
 }
 return targets;
}
