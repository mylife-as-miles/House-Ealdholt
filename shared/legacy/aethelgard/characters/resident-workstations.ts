/** Physical interaction ownership below saved ordinary jobs. Source producers
 * own geometry/clip certification; this owner supplies exclusive leases and
 * accepts only evaluated, source-bound pose/contact/release observations.
 * No renderer, timer, routine reservation or inventory balance is consulted. */
import {copyObserverJSON} from '../observer/observer-json';
import {placeDataArray,placeDataRecord} from '../place-use';
import type {ResidentAnimationEvent} from './resident-animation-execution';
import type {ResidentActionContact,ResidentActionFacing,ResidentActionLease,ResidentActionPhysicalStation,ResidentActionRelease,ResidentActionSource} from './resident-action-queue';
import type {ResidentRoutineActionPhysicalContext,ResidentRoutineActionPhysicalPort} from './resident-routine-actions';

export type WorkstationPoint=readonly[number,number,number];
export interface ResidentWorkstation {
 readonly station:ResidentActionPhysicalStation;
 /** Shared by every person who uses this one physical piece of equipment. */
 readonly resourceId:string;
 readonly standPosition:WorkstationPoint;readonly yawRadians:number;
 readonly maximumStandDistanceMetres:number;readonly maximumFacingErrorRadians:number;
 readonly contactPoint:WorkstationPoint;readonly maximumToolContactDistanceMetres:number;
 readonly markerIds:readonly string[];
}
export interface ResidentWorkstationObservation {
 readonly residentId:string;readonly jobId:string;readonly stationId:string;readonly atMinute:number;
 readonly source:ResidentActionSource;readonly stationCertificateSha256:string;
 readonly position:WorkstationPoint;readonly yawRadians:number;
 readonly poseSourceQualified:boolean;readonly fullyWeighted:boolean;readonly activeClip:string|null;
 readonly contact:{readonly event:ResidentAnimationEvent;readonly toolPoint:WorkstationPoint;readonly targetPoint:WorkstationPoint;readonly contactSourceActor:string}|null;
 /** Actual equipment-owner release; expiry or an idle schedule cannot supply it. */
 readonly equipmentReleased:boolean;
}
export interface ResidentWorkstationEntry {
 readonly lease:ResidentActionLease;readonly resourceId:string;readonly stationCertificateSha256:string;
 readonly phase?:'reserve'|'face'|'perform'|'release';readonly phaseStartedAtMinute?:number;
 readonly performStartedAtMinute:number|null;readonly nextContactSequence:number;
 readonly consumedMarkerKeys:readonly string[];
 readonly facing:ResidentActionFacing|null;readonly contact:ResidentActionContact|null;
}
export interface ResidentWorkstations {
 readonly kind:'resident-workstations';readonly schemaVersion:1;readonly worldKey:string;
 readonly source:ResidentActionSource;readonly absoluteMinute:number;readonly nextLeaseSequence:number;
 readonly entries:readonly ResidentWorkstationEntry[];readonly releases:readonly ResidentActionRelease[];
}
export interface AdvanceResidentWorkstationsInput {
 readonly absoluteMinute:number;readonly mode?:'allocate'|'observe';readonly catalog:readonly ResidentWorkstation[];
 readonly requests:readonly ResidentRoutineActionPhysicalContext[];
 readonly observations:readonly ResidentWorkstationObservation[];
}
const trusted=new WeakSet<object>();
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const integer=(v:unknown):v is number=>number(v)&&Number.isSafeInteger(v)&&v>=0;
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=2048&&v.trim()===v&&!/[\u0000-\u001f\u007f]/u.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const xyz=(v:unknown):v is WorkstationPoint=>Array.isArray(v)&&v.length===3&&v.every(number);
const sameSource=(a:ResidentActionSource,b:ResidentActionSource)=>a.profile===b.profile&&a.sha256===b.sha256&&a.siteIdentity===b.siteIdentity;
const distance=(a:WorkstationPoint,b:WorkstationPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const facingError=(a:number,b:number)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
function frozen<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
function source(value:unknown):ResidentActionSource{
 const r=placeDataRecord(value,['profile','sha256','siteIdentity']);if(!['desktop','quest'].includes(r.profile as string)||!hash(r.sha256)||!id(r.siteIdentity))throw Error('Workstation source identity is invalid.');return value as ResidentActionSource;
}
export function parseResidentWorkstationCatalog(value:unknown,expected:ResidentActionSource):readonly ResidentWorkstation[]{
 source(expected);const rows=placeDataArray(value);if(rows.length>512)throw Error('Physical workstation catalogue exceeds its bounded budget.');const seen=new Set<string>();
 for(const value of rows){const r=placeDataRecord(value,['station','resourceId','standPosition','yawRadians','maximumStandDistanceMetres','maximumFacingErrorRadians','contactPoint','maximumToolContactDistanceMetres','markerIds']);
  const s=placeDataRecord(r.station,['id','residentId','placeId','anchorId','source','clip','certificateSha256','durationWorldMinutes','proof']),p=placeDataRecord(s.proof,['originalTriangleClearance','wholeFootprintSupported','sweptClipAndPropsClear','contactSourceActor']);
  if(!id(s.id)||seen.has(s.id)||!id(s.residentId)||!id(s.placeId)||!id(s.anchorId)||!id(s.clip)||!hash(s.certificateSha256)||!sameSource(source(s.source),expected)
   ||!integer(s.durationWorldMinutes)||s.durationWorldMinutes<1||s.durationWorldMinutes>240||p.originalTriangleClearance!==true||p.wholeFootprintSupported!==true||p.sweptClipAndPropsClear!==true||!id(p.contactSourceActor)
   ||!id(r.resourceId)||!xyz(r.standPosition)||!xyz(r.contactPoint)||!number(r.yawRadians)||!number(r.maximumStandDistanceMetres)||r.maximumStandDistanceMetres<=0||r.maximumStandDistanceMetres>.15
   ||!number(r.maximumFacingErrorRadians)||r.maximumFacingErrorRadians<=0||r.maximumFacingErrorRadians>.15||!number(r.maximumToolContactDistanceMetres)||r.maximumToolContactDistanceMetres<=0||r.maximumToolContactDistanceMetres>.2
   ||!placeDataArray(r.markerIds).length||(r.markerIds as unknown[]).length>128||(r.markerIds as unknown[]).some(v=>!id(v))||new Set(r.markerIds as unknown[]).size!==(r.markerIds as unknown[]).length)throw Error('Physical workstation catalogue lacks its exact source/pose/contact contract.');
  seen.add(s.id);
 }
 return value as readonly ResidentWorkstation[];
}
function entry(value:unknown,s:ResidentWorkstations):ResidentWorkstationEntry{
 const r=placeDataRecord(value,['lease','resourceId','stationCertificateSha256','performStartedAtMinute','nextContactSequence','consumedMarkerKeys','facing','contact'],['phase','phaseStartedAtMinute']),l=placeDataRecord(r.lease,['id','residentId','jobId','stationId','source','sinceMinute','untilMinute']);
 if(!id(l.id)||!id(l.residentId)||!id(l.jobId)||!id(l.stationId)||!sameSource(source(l.source),s.source)||!integer(l.sinceMinute)||l.sinceMinute>s.absoluteMinute||!integer(l.untilMinute)||l.untilMinute<l.sinceMinute||l.untilMinute>s.absoluteMinute+248
  ||!id(r.resourceId)||!hash(r.stationCertificateSha256)||r.performStartedAtMinute!==null&&(!integer(r.performStartedAtMinute)||r.performStartedAtMinute<l.sinceMinute||r.performStartedAtMinute>s.absoluteMinute)
  ||((r.phase===undefined)!==(r.phaseStartedAtMinute===undefined))||r.phase!==undefined&&(!['reserve','face','perform','release'].includes(r.phase as string)||!integer(r.phaseStartedAtMinute)||r.phaseStartedAtMinute<l.sinceMinute||r.phaseStartedAtMinute>s.absoluteMinute)
  ||!integer(r.nextContactSequence)||!placeDataArray(r.consumedMarkerKeys)||placeDataArray(r.consumedMarkerKeys).length>64||(r.consumedMarkerKeys as unknown[]).some(v=>!id(v)))throw Error('Invalid saved physical workstation lease.');
 for(const name of ['facing','contact']as const){const proof=r[name];if(proof===null)continue;const p=placeDataRecord(proof,name==='facing'?['id','residentId','jobId','stationId','leaseId','source','atMinute','sourcePoseQualified']:['id','residentId','jobId','stationId','leaseId','source','atMinute','sequence','clip','markerId','contactSourceActor','contactQualified']);
  if(!id(p.id)||p.residentId!==l.residentId||p.jobId!==l.jobId||p.stationId!==l.stationId||p.leaseId!==l.id||!sameSource(source(p.source),s.source)||p.atMinute!==s.absoluteMinute
   ||name==='facing'&&p.sourcePoseQualified!==true||name==='contact'&&(!integer(p.sequence)||p.sequence>=r.nextContactSequence||!id(p.clip)||!id(p.markerId)||!id(p.contactSourceActor)||p.contactQualified!==true))throw Error('Saved workstation observation belongs to another physical owner/time.');
 }
 return value as ResidentWorkstationEntry;
}
export function parseResidentWorkstations(value:unknown,expected?:{readonly worldKey:string;readonly source?:ResidentActionSource}):ResidentWorkstations{
 const s=(value&&typeof value==='object'&&trusted.has(value)?value:copyObserverJSON(typeof value==='string'?JSON.parse(value):value))as ResidentWorkstations;
 placeDataRecord(s,['kind','schemaVersion','worldKey','source','absoluteMinute','nextLeaseSequence','entries','releases']);
 if(s.kind!=='resident-workstations'||s.schemaVersion!==1||!id(s.worldKey)||expected&&s.worldKey!==expected.worldKey||!integer(s.absoluteMinute)||!integer(s.nextLeaseSequence)||expected?.source&&!sameSource(source(s.source),expected.source))throw Error('Saved workstation ownership belongs to another world/source/time.');source(s.source);
 const resources=new Set<string>(),people=new Set<string>(),leases=new Set<string>();if(placeDataArray(s.entries).length>100||placeDataArray(s.releases).length>100)throw Error('Physical workstation ownership exceeds the roster budget.');
 for(const raw of s.entries){const row=entry(raw,s);if(resources.has(row.resourceId)||people.has(row.lease.residentId)||leases.has(row.lease.id))throw Error('Physical equipment cannot have simultaneous duplicate owners.');resources.add(row.resourceId);people.add(row.lease.residentId);leases.add(row.lease.id);}
 for(const raw of s.releases){const r=placeDataRecord(raw,['id','residentId','jobId','stationId','leaseId','source','atMinute']);if(!id(r.id)||!id(r.residentId)||!id(r.jobId)||!id(r.stationId)||!id(r.leaseId)||!sameSource(source(r.source),s.source)||r.atMinute!==s.absoluteMinute)throw Error('Invalid saved physical equipment release.');}
 frozen(s);trusted.add(s);return s;
}
export function createResidentWorkstations(worldKey:string,inputSource:ResidentActionSource,absoluteMinute:number):ResidentWorkstations{
 return parseResidentWorkstations({kind:'resident-workstations',schemaVersion:1,worldKey,source:inputSource,absoluteMinute,nextLeaseSequence:0,entries:[],releases:[]});
}
function validObservation(value:unknown,now:number):ResidentWorkstationObservation{
 const r=placeDataRecord(value,['residentId','jobId','stationId','atMinute','source','stationCertificateSha256','position','yawRadians','poseSourceQualified','fullyWeighted','activeClip','contact','equipmentReleased']);
 if(!id(r.residentId)||!id(r.jobId)||!id(r.stationId)||r.atMinute!==now||!hash(r.stationCertificateSha256)||!xyz(r.position)||!number(r.yawRadians)||typeof r.poseSourceQualified!=='boolean'||typeof r.fullyWeighted!=='boolean'||r.activeClip!==null&&!id(r.activeClip)||typeof r.equipmentReleased!=='boolean')throw Error('Invalid measured workstation pose.');source(r.source);
 if(r.contact!==null){const c=placeDataRecord(r.contact,['event','toolPoint','targetPoint','contactSourceActor']),e=placeDataRecord(c.event,['ownerId','requestId','motion','clipId','kind','state','seconds','loop','hold','markerId','markerName','markerKind']);
  if(!xyz(c.toolPoint)||!xyz(c.targetPoint)||!id(c.contactSourceActor)||!id(e.ownerId)||!integer(e.requestId)||!number(e.seconds)||e.seconds<0||!integer(e.loop))throw Error('Invalid evaluated workstation contact.');
 }
 return value as ResidentWorkstationObservation;
}
/** Call once at an authoritative world-minute boundary, before consuming the
 * ordinary queues. Actual current observations may also refresh the same minute;
 * duplicate marker identities can never issue another physical contact. */
export function advanceResidentWorkstations(value:ResidentWorkstations,input:AdvanceResidentWorkstationsInput):ResidentWorkstations{
 const old=parseResidentWorkstations(value),now=input.absoluteMinute;if(input.mode!==undefined&&!['allocate','observe'].includes(input.mode))throw Error('Unknown workstation update mode.');if(!integer(now)||now<old.absoluteMinute)throw Error('Physical workstation time cannot rewind.');
 const catalog=parseResidentWorkstationCatalog(input.catalog,old.source),observed=new Map<string,ResidentWorkstationObservation>();
 if(input.requests.length>100||input.observations.length>100)throw Error('Physical workstation input exceeds the roster budget.');
 for(const raw of input.observations){const o=validObservation(raw,now);if(observed.has(o.residentId))throw Error('Duplicate workstation pose owner.');observed.set(o.residentId,o);}
 const requests=new Map<string,ResidentRoutineActionPhysicalContext>();for(const r of input.requests){if(r.worldKey!==old.worldKey||r.absoluteMinute!==now||!sameSource(r.source,old.source)||requests.has(r.residentId))throw Error('Physical workstation request has foreign ownership.');requests.set(r.residentId,r);}
 const entries:ResidentWorkstationEntry[]=[],releases:ResidentActionRelease[]=input.mode==='allocate'&&now===old.absoluteMinute?[...old.releases]:[],occupied=new Set<string>();let sequence=old.nextLeaseSequence;
 const eligible=(r:ResidentRoutineActionPhysicalContext,station:ResidentWorkstation)=>!!r.queue&&r.queue.residentId===r.residentId&&!r.queue.interruption&&['reserve','face','perform','release'].includes(r.queue.current??'')
  &&station.station.residentId===r.residentId&&station.station.placeId===r.goal.targetPlaceId&&!!r.arrival&&r.arrival.residentId===r.residentId&&r.arrival.placeId===station.station.placeId&&r.arrival.anchorId===station.station.anchorId&&r.arrival.kind==='certified-route-arrival'&&r.arrival.exclusivelyOwned===true&&sameSource(r.arrival.source,old.source)
  &&!r.journey.inside&&!r.journey.route&&r.journey.arrivalEvidence==='certified-route-arrival'&&r.journey.targetPlaceId===r.goal.targetPlaceId;
 for(const prior of old.entries){const request=requests.get(prior.lease.residentId),station=catalog.find(row=>row.station.id===prior.lease.stationId);
  if(!request||!station||request.queue?.jobId!==prior.lease.jobId||prior.lease.untilMinute<now||station.resourceId!==prior.resourceId||station.station.certificateSha256!==prior.stationCertificateSha256||!eligible(request,station))continue;
  entries.push({...prior,facing:input.mode==='allocate'&&now===old.absoluteMinute?prior.facing:null,contact:input.mode==='allocate'&&now===old.absoluteMinute?prior.contact:null});occupied.add(prior.resourceId);
 }
 for(const request of [...requests.values()].sort((a,b)=>a.residentId.localeCompare(b.residentId))){if(entries.some(e=>e.lease.residentId===request.residentId))continue;
  const station=catalog.find(s=>!occupied.has(s.resourceId)&&eligible(request,s));if(!station)continue;
  const lease:ResidentActionLease={id:`work-lease:${sequence++}:${request.residentId}`,residentId:request.residentId,jobId:request.queue!.jobId,stationId:station.station.id,source:old.source,sinceMinute:now,untilMinute:now+station.station.durationWorldMinutes+8};
  entries.push({lease,resourceId:station.resourceId,stationCertificateSha256:station.station.certificateSha256,phase:request.queue!.current as ResidentWorkstationEntry['phase'],phaseStartedAtMinute:now,performStartedAtMinute:null,nextContactSequence:1,consumedMarkerKeys:[],facing:null,contact:null});occupied.add(station.resourceId);
 }
 const next:ResidentWorkstationEntry[]=[];
 for(let row of entries){const request=requests.get(row.lease.residentId)!,station=catalog.find(s=>s.station.id===row.lease.stationId)!,o=observed.get(row.lease.residentId),q=request.queue!;
  if(q.current==='perform'&&row.performStartedAtMinute===null){const face=old.entries.find(e=>e.lease.id===row.lease.id)?.facing;row={...row,performStartedAtMinute:face&&face.id===q.proof.facingId?face.atMinute:now};}
  if(row.phase!==q.current||row.phaseStartedAtMinute===undefined){const started=q.current==='perform'?row.performStartedAtMinute??now:q.current==='release'?q.proof.lastContactMinute??now:row.lease.sinceMinute;row={...row,phase:q.current as ResidentWorkstationEntry['phase'],phaseStartedAtMinute:Math.max(row.lease.sinceMinute,started)};}
  if(input.mode==='allocate'){next.push(row);continue;}
  const pose=!!o&&o.jobId===row.lease.jobId&&o.stationId===row.lease.stationId&&sameSource(o.source,old.source)&&o.stationCertificateSha256===row.stationCertificateSha256&&o.poseSourceQualified&&o.fullyWeighted
   &&distance(o.position,station.standPosition)<=station.maximumStandDistanceMetres&&facingError(o.yawRadians,station.yawRadians)<=station.maximumFacingErrorRadians;
  if(pose){row={...row,facing:{id:`work-facing:${row.lease.id}`,residentId:row.lease.residentId,jobId:row.lease.jobId,stationId:row.lease.stationId,leaseId:row.lease.id,source:old.source,atMinute:now,sourcePoseQualified:true}};
   if(q.current==='release'&&o!.equipmentReleased&&o!.activeClip!==station.station.clip){releases.push({id:`work-release:${row.lease.id}`,residentId:row.lease.residentId,jobId:row.lease.jobId,stationId:row.lease.stationId,leaseId:row.lease.id,source:old.source,atMinute:now});}
   const contact=o!.contact,e=contact?.event,key=e?`${e.requestId}:${e.loop}:${e.markerId}`:null;
   if(q.current==='perform'&&contact&&e&&key&&o!.activeClip===station.station.clip&&e.ownerId===row.lease.residentId&&e.clipId===station.station.clip&&e.kind==='marker'&&e.markerKind==='contact'&&e.state==='playing'&&e.hold==='none'
    &&e.markerId!==null&&station.markerIds.includes(e.markerId)&&contact.contactSourceActor===station.station.proof.contactSourceActor&&distance(contact.targetPoint,station.contactPoint)<=.005&&distance(contact.toolPoint,contact.targetPoint)<=station.maximumToolContactDistanceMetres){
    const prior=old.absoluteMinute===now?old.entries.find(e=>e.lease.id===row.lease.id)?.contact:null;
    if(row.consumedMarkerKeys.includes(key)){if(prior?.id===`work-contact:${row.lease.id}:${key}`)row={...row,contact:prior};}
    else row={...row,nextContactSequence:row.nextContactSequence+1,consumedMarkerKeys:[...row.consumedMarkerKeys,key].slice(-64),contact:{id:`work-contact:${row.lease.id}:${key}`,residentId:row.lease.residentId,jobId:row.lease.jobId,stationId:row.lease.stationId,leaseId:row.lease.id,source:old.source,atMinute:now,sequence:row.nextContactSequence,clip:station.station.clip,markerId:e.markerId,contactSourceActor:station.station.proof.contactSourceActor,contactQualified:true}};
   }
  }
  next.push(row);
 }
 const result=parseResidentWorkstations({kind:'resident-workstations',schemaVersion:1,worldKey:old.worldKey,source:old.source,absoluteMinute:now,nextLeaseSequence:sequence,entries:next,releases});
 return JSON.stringify(result)===JSON.stringify(old)?old:result;
}
/** A read-only provider. No observe() call allocates equipment or makes a marker. */
export function createResidentWorkstationPhysicalPort(value:ResidentWorkstations,inputCatalog:readonly ResidentWorkstation[]):ResidentRoutineActionPhysicalPort{
 const state=parseResidentWorkstations(value),catalog=parseResidentWorkstationCatalog(inputCatalog,state.source);
 return Object.freeze({observe(context:ResidentRoutineActionPhysicalContext){
  if(context.worldKey!==state.worldKey||context.absoluteMinute!==state.absoluteMinute||!sameSource(context.source,state.source)||!context.queue)return null;
  const station=catalog.find(s=>s.station.residentId===context.residentId&&s.station.placeId===context.goal.targetPlaceId),row=state.entries.find(e=>e.lease.residentId===context.residentId&&e.lease.jobId===context.queue!.jobId&&e.lease.stationId===station?.station.id),released=state.releases.filter(r=>r.residentId===context.residentId&&r.jobId===context.queue!.jobId);
  return{station:station?.station??null,lease:row?.lease??null,facing:row?.facing??null,contacts:row?.contact?[row.contact]:[],releases:released,invalidatedTarget:!station&&!!context.queue.proof.stationBinding};
 }});
}
