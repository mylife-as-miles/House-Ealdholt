/** Finite local timber, earned only by a completed source-qualified work job.
 * The source catalogue describes authored gameplay capacity in real source
 * actors; it is not a free stockpile, a render counter or a harvest timer. */
import {placeDataArray,placeDataRecord} from '../place-use';
import {parseResidentActionQueues,type ResidentActionQueues} from '../characters/resident-action-queue';
import {parseBuildingDamageBinding,buildingDamageKey,type BuildingDamageBinding} from './building-damage';

export interface VillageTimberSource {
 readonly id:string;readonly profile:'desktop'|'quest';readonly sourceSha256:string;readonly siteIdentity:string;
 readonly sourceActor:string;readonly sourceInstance:string;readonly transformSha256:string;readonly certificateSha256:string;
 /** Authored material units and processing yield; never represented as a
  * measured number of GLB logs. No depot timber exists until work completes. */
 readonly rawUnits:number;readonly timberPerUnit:number;
}
export interface VillageTimberOperation {
 readonly sourceId:string;readonly residentId:string;readonly stationId:string;readonly placeId:string;
 readonly stationCertificateSha256:string;readonly clip:'work_chop_wood';readonly contactSourceActor:string;
 readonly requiredWorldMinutes:number;
}
export interface VillageTimberCatalogue {
 readonly sources:readonly VillageTimberSource[];readonly operations:readonly VillageTimberOperation[];
}
export interface VillageTimberSourceStock extends VillageTimberSource {readonly remainingUnits:number;readonly registeredAtMinute:number}
export interface VillageTimberWorkWatermark {readonly residentId:string;readonly jobSequence:number;readonly jobId:string;readonly completedAtMinute:number}
export interface VillageTimberAllocation {
 readonly id:string;readonly incidentId:string;readonly binding:BuildingDamageBinding;readonly atMinute:number;readonly timber:number;
}
export interface VillageTimberSupply {
 readonly kind:'village-timber-supply';readonly schemaVersion:1;readonly worldKey:string;
 readonly generation:number;readonly createdAtMinute:number;readonly absoluteMinute:number;readonly sources:readonly VillageTimberSourceStock[];
 readonly availableTimber:number;readonly producedTimber:number;readonly allocatedTimber:number;
 readonly workWatermarks:readonly VillageTimberWorkWatermark[];readonly allocations:readonly VillageTimberAllocation[];
}
export interface VillageTimberHarvestReceipt {
 readonly residentId:string;readonly jobId:string;readonly sourceId:string;readonly completedAtMinute:number;
 readonly consumedRawUnits:1;readonly timber:number;
}
export interface VillageTimberHarvestResult {
 readonly state:VillageTimberSupply;readonly receipts:readonly VillageTimberHarvestReceipt[];
 readonly held:readonly {readonly residentId:string;readonly jobId:string;readonly reason:string}[];
}
export const VILLAGE_TIMBER_SUPPLY_MAX_BYTES=128*1024;
const MAX_TIMBER=1_000_000_000,MAX_SOURCES=128,MAX_RAW_UNITS=64,MAX_ALLOCATIONS=128;
const trusted=new WeakSet<object>();
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
function text(v:unknown,max=512):string{if(typeof v!=='string'||!v||v.length>max||v.trim()!==v||/[\u0000-\u001f\u007f]/u.test(v)||['__proto__','prototype','constructor'].includes(v))throw Error('Timber supply needs bounded explicit identities.');return v;}
function freeze<T>(v:T):T{if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;}
const SOURCE_KEYS=['id','profile','sourceSha256','siteIdentity','sourceActor','sourceInstance','transformSha256','certificateSha256','rawUnits','timberPerUnit'] as const;
function source(value:unknown,stock=false):VillageTimberSourceStock{
 const r=placeDataRecord(value,stock?[...SOURCE_KEYS,'remainingUnits','registeredAtMinute']:SOURCE_KEYS);
 const result={id:text(r.id,160),profile:r.profile as 'desktop'|'quest',sourceSha256:r.sourceSha256 as string,siteIdentity:text(r.siteIdentity,512),sourceActor:text(r.sourceActor,512),sourceInstance:text(r.sourceInstance,256),transformSha256:r.transformSha256 as string,certificateSha256:r.certificateSha256 as string,rawUnits:r.rawUnits as number,timberPerUnit:r.timberPerUnit as number,remainingUnits:stock?r.remainingUnits as number:r.rawUnits as number,registeredAtMinute:stock?r.registeredAtMinute as number:0};
 if(!['desktop','quest'].includes(result.profile)||![result.sourceSha256,result.transformSha256,result.certificateSha256].every(hash)||!integer(result.rawUnits,1,MAX_RAW_UNITS)||!integer(result.timberPerUnit,1,BUILDING_UNIT_LIMIT)||!integer(result.remainingUnits,0,result.rawUnits)||!integer(result.registeredAtMinute))throw Error('Invalid finite source timber capacity or certificate.');return freeze(result);
}
const BUILDING_UNIT_LIMIT=64;
function actorKey(v:VillageTimberSource):string{return JSON.stringify([v.profile,v.sourceSha256,v.sourceActor,v.sourceInstance]);}
function sameSource(a:VillageTimberSource,b:VillageTimberSource):boolean{return SOURCE_KEYS.every(k=>a[k]===b[k]);}
export function parseVillageTimberCatalogue(value:unknown):VillageTimberCatalogue{
 const r=placeDataRecord(value,['sources','operations']),rawSources=placeDataArray(r.sources),rawOperations=placeDataArray(r.operations);
 if(rawSources.length>MAX_SOURCES||rawOperations.length>256)throw Error('Timber catalogue exceeds finite source/operation limits.');
 const sources=rawSources.map(s=>{const{remainingUnits:_,registeredAtMinute:_registered,...entry}=source(s);return freeze(entry);}),ids=new Set<string>(),actors=new Set<string>();
 for(const s of sources){if(ids.has(s.id)||actors.has(actorKey(s)))throw Error('A raw timber actor cannot be declared twice.');ids.add(s.id);actors.add(actorKey(s));}
 const operationKeys=new Set<string>();const operations=rawOperations.map(value=>{
  const o=placeDataRecord(value,['sourceId','residentId','stationId','placeId','stationCertificateSha256','clip','contactSourceActor','requiredWorldMinutes']);
  const result={sourceId:text(o.sourceId,160),residentId:text(o.residentId,160),stationId:text(o.stationId,512),placeId:text(o.placeId,256),stationCertificateSha256:o.stationCertificateSha256 as string,clip:o.clip as 'work_chop_wood',contactSourceActor:text(o.contactSourceActor,512),requiredWorldMinutes:o.requiredWorldMinutes as number};
  const key=JSON.stringify([result.residentId,result.stationId]);if(!ids.has(result.sourceId)||operationKeys.has(key)||!hash(result.stationCertificateSha256)||result.clip!=='work_chop_wood'||!integer(result.requiredWorldMinutes,1,240))throw Error('Invalid or ambiguous source timber operation.');operationKeys.add(key);return freeze(result);
 });return freeze({sources,operations});
}
function publish(s:VillageTimberSupply):VillageTimberSupply{
 if(!integer(s.generation))throw Error('Timber ledger generation overflow.');
 if(new TextEncoder().encode(JSON.stringify(s)).byteLength>VILLAGE_TIMBER_SUPPLY_MAX_BYTES)throw Error('Timber ledger exceeds its bounded persistence budget.');freeze(s);trusted.add(s);return s;
}
export function createVillageTimberSupply(worldKey:string,absoluteMinute:number):VillageTimberSupply{
 text(worldKey,2048);if(!integer(absoluteMinute))throw Error('Timber supply shares the existing world minute.');
 return publish({kind:'village-timber-supply',schemaVersion:1,worldKey,generation:0,createdAtMinute:absoluteMinute,absoluteMinute,sources:[],availableTimber:0,producedTimber:0,allocatedTimber:0,workWatermarks:[],allocations:[]});
}
export function parseVillageTimberSupply(value:unknown,expectedWorldKey?:string):VillageTimberSupply{
 if(value&&typeof value==='object'&&trusted.has(value)){const s=value as VillageTimberSupply;if(expectedWorldKey!==undefined&&s.worldKey!==expectedWorldKey)throw Error('Timber belongs to another world.');return s;}
 if(typeof value==='string'){if(new TextEncoder().encode(value).byteLength>VILLAGE_TIMBER_SUPPLY_MAX_BYTES)throw Error('Timber save exceeds its bounded JSON budget.');value=JSON.parse(value);}
 const r=placeDataRecord(value,['kind','schemaVersion','worldKey','generation','createdAtMinute','absoluteMinute','sources','availableTimber','producedTimber','allocatedTimber','workWatermarks','allocations']);
 if(r.kind!=='village-timber-supply'||r.schemaVersion!==1||!integer(r.generation)||!integer(r.absoluteMinute)||!integer(r.createdAtMinute,0,r.absoluteMinute))throw Error('Unsupported timber ledger or clock.');
 const worldKey=text(r.worldKey,2048);if(expectedWorldKey!==undefined&&worldKey!==expectedWorldKey)throw Error('Timber belongs to another world.');
 const rawSources=placeDataArray(r.sources),rawMarks=placeDataArray(r.workWatermarks),rawAllocations=placeDataArray(r.allocations);if(rawSources.length>MAX_SOURCES||rawMarks.length>100||rawAllocations.length>MAX_ALLOCATIONS)throw Error('Timber ledger exceeds finite ownership limits.');
 const sources=rawSources.map(v=>source(v,true)),ids=new Set<string>(),actors=new Set<string>();let produced=0;
 let consumedUnits=0;for(const s of sources){if(ids.has(s.id)||actors.has(actorKey(s))||s.registeredAtMinute<(r.createdAtMinute as number)||s.registeredAtMinute>(r.absoluteMinute as number))throw Error('Raw timber source is duplicated or precedes adoption.');ids.add(s.id);actors.add(actorKey(s));consumedUnits+=s.rawUnits-s.remainingUnits;produced+=(s.rawUnits-s.remainingUnits)*s.timberPerUnit;}
 const residents=new Set<string>();const workWatermarks=rawMarks.map(v=>{const m=placeDataRecord(v,['residentId','jobSequence','jobId','completedAtMinute']),residentId=text(m.residentId,160),jobId=text(m.jobId,512);if(residents.has(residentId)||!integer(m.jobSequence)||jobId!==`resident-job:${m.jobSequence}:${residentId}`||!integer(m.completedAtMinute,r.createdAtMinute as number,r.absoluteMinute as number))throw Error('Invalid or duplicated consumed work watermark.');residents.add(residentId);return freeze({residentId,jobSequence:m.jobSequence,jobId,completedAtMinute:m.completedAtMinute});});
 const allocated=new Set<string>();let allocatedTimber=0;const allocations=rawAllocations.map(v=>{const a=placeDataRecord(v,['id','incidentId','binding','atMinute','timber']),incidentId=text(a.incidentId,512),id=text(a.id,1024),binding=parseBuildingDamageBinding(a.binding);if(allocated.has(id)||id!==`local-rebuild:${incidentId}`||!integer(a.atMinute,0,r.absoluteMinute as number)||!integer(a.timber,1,12))throw Error('Invalid or replayed local timber allocation.');allocated.add(id);allocatedTimber+=a.timber;return freeze({id,incidentId,binding,atMinute:a.atMinute,timber:a.timber});});
 if(!integer(produced,0,MAX_TIMBER)||r.producedTimber!==produced||r.allocatedTimber!==allocatedTimber||r.availableTimber!==produced-allocatedTimber||!integer(r.availableTimber,0,MAX_TIMBER)||produced>0&&!workWatermarks.length||workWatermarks.length>consumedUnits)throw Error('Timber save violates finite production/consumption conservation.');
 return publish({kind:'village-timber-supply',schemaVersion:1,worldKey,generation:r.generation as number,createdAtMinute:r.createdAtMinute as number,absoluteMinute:r.absoluteMinute as number,sources,availableTimber:r.availableTimber as number,producedTimber:produced,allocatedTimber,workWatermarks,allocations});
}
export function advanceVillageTimberSupply(value:VillageTimberSupply,absoluteMinute:number):VillageTimberSupply{
 const s=parseVillageTimberSupply(value);if(!integer(absoluteMinute)||absoluteMinute<s.absoluteMinute)throw Error('Timber clock cannot rewind.');if(absoluteMinute===s.absoluteMinute)return s;return publish({...s,absoluteMinute,generation:s.generation+1});
}
/** Observing a source registers finite unprocessed material, never depot stock.
 * Source drift cannot refill a depleted actor, even under a different label. */
export function registerVillageTimberSources(value:VillageTimberSupply,catalogue:VillageTimberCatalogue):VillageTimberSupply{
 const s=parseVillageTimberSupply(value),c=parseVillageTimberCatalogue(catalogue),sources=[...s.sources];let changed=false;
 for(const entry of c.sources){const old=sources.find(v=>v.id===entry.id||actorKey(v)===actorKey(entry));if(old){if(!sameSource(old,entry))throw Error('A saved finite timber actor changed identity or capacity.');continue;}if(sources.length>=MAX_SOURCES)throw Error('Finite timber source limit reached.');sources.push(freeze({...entry,remainingUnits:entry.rawUnits,registeredAtMinute:s.absoluteMinute}));changed=true;}
 return changed?publish({...s,sources,generation:s.generation+1}):s;
}
/** Consume only current completed queue jobs. Monotonic per-resident consumed
 * sequence survives task replacement and rejects replay of any earlier job. */
export function consumeCompletedTimberWork(value:VillageTimberSupply,input:{readonly queues:ResidentActionQueues;readonly catalogue:VillageTimberCatalogue;readonly absoluteMinute:number}):VillageTimberHarvestResult{
 const old=parseVillageTimberSupply(value),queues=parseResidentActionQueues(input.queues,{worldKey:old.worldKey,maximumMinute:input.absoluteMinute}),catalogue=parseVillageTimberCatalogue(input.catalogue);
 if(!integer(input.absoluteMinute)||queues.absoluteMinute!==input.absoluteMinute)throw Error('Timber work shares the actual queue world-minute boundary.');
 const s=registerVillageTimberSources(advanceVillageTimberSupply(old,input.absoluteMinute),catalogue),sources=s.sources.map(v=>({...v})),marks=s.workWatermarks.map(v=>({...v})),receipts:VillageTimberHarvestReceipt[]=[],held:{residentId:string;jobId:string;reason:string}[]=[];let produced=s.producedTimber;
 for(const job of queues.residents){
  if(job.current!==null||job.completedAtMinute===null)continue;const station=job.proof.stationBinding,operation=station?catalogue.operations.find(o=>o.residentId===job.residentId&&o.stationId===station.id):undefined;if(!operation)continue;
  const block=(reason:string)=>held.push({residentId:job.residentId,jobId:job.jobId,reason});
  const entry=sources.find(v=>v.id===operation.sourceId)!,match=/^resident-job:(\d+):/u.exec(job.jobId)!,sequence=Number(match[1]),watermark=marks.find(m=>m.residentId===job.residentId);
  if(watermark&&(sequence<=watermark.jobSequence||job.completedAtMinute<=watermark.completedAtMinute)){block('work-already-consumed');continue;}
  if(job.completedAtMinute<entry.registeredAtMinute||job.completedAtMinute<s.createdAtMinute){block('work-before-source-adoption');continue;}
  // lastContactMinute is the live consecutive-contact latch. The legitimate
  // release pose can clear it once work is finished; completion, pinned station,
  // performed duration, contact count and the consumed job watermark are the
  // durable receipt. Requiring the live latch after release strands real work.
  if(!station||!queues.source||queues.source.profile!==entry.profile||queues.source.sha256!==entry.sourceSha256||queues.source.siteIdentity!==entry.siteIdentity||station.source.profile!==entry.profile||station.source.sha256!==entry.sourceSha256||station.source.siteIdentity!==entry.siteIdentity||station.certificateSha256!==operation.stationCertificateSha256||station.placeId!==operation.placeId||job.goal.targetPlaceId!==operation.placeId||station.clip!==operation.clip||station.proof.contactSourceActor!==operation.contactSourceActor||station.durationWorldMinutes!==operation.requiredWorldMinutes||job.performedWorldMinutes!==operation.requiredWorldMinutes||job.proof.contactCount<operation.requiredWorldMinutes+1||job.completedAtMinute>input.absoluteMinute){block('timber-operation-unqualified');continue;}
  if(entry.remainingUnits<1){block('raw-timber-depleted');continue;}
  if(!integer(produced+entry.timberPerUnit,0,MAX_TIMBER))throw Error('Timber production capacity exhausted.');entry.remainingUnits--;produced+=entry.timberPerUnit;
  const consumed={residentId:job.residentId,jobSequence:sequence,jobId:job.jobId,completedAtMinute:job.completedAtMinute};if(watermark)marks[marks.indexOf(watermark)]=consumed;else marks.push(consumed);
  receipts.push({residentId:job.residentId,jobId:job.jobId,sourceId:entry.id,completedAtMinute:job.completedAtMinute,consumedRawUnits:1,timber:entry.timberPerUnit});
 }
 const state=receipts.length?publish({...s,sources,workWatermarks:marks,producedTimber:produced,availableTimber:produced-s.allocatedTimber,generation:s.generation+1}):s;
 return freeze({state,receipts,held});
}
/** Debit a named incident exactly once. The owning rebuild transaction must
 * commit this result and the matching damage/order together or neither. */
export function allocateVillageTimber(value:VillageTimberSupply,input:{readonly incidentId:string;readonly binding:BuildingDamageBinding;readonly atMinute:number;readonly timber:number}):VillageTimberSupply{
 const s=advanceVillageTimberSupply(value,input.atMinute),incidentId=text(input.incidentId,512),binding=parseBuildingDamageBinding(input.binding),id=`local-rebuild:${incidentId}`;
 if(!integer(input.timber,1,12))throw Error('Local reconstruction consumes an explicit bounded timber quantity.');
 const old=s.allocations.find(a=>a.id===id);if(old){if(old.timber!==input.timber||buildingDamageKey(old.binding)!==buildingDamageKey(binding)||old.binding.siteIndex!==binding.siteIndex)throw Error('An existing timber allocation changed target or quantity.');return s;}
 if(s.allocations.length>=MAX_ALLOCATIONS||s.availableTimber<input.timber)throw Error(`Needs ${input.timber} earned local timber.`);
 return publish({...s,generation:s.generation+1,allocations:[...s.allocations,{id,incidentId,binding,atMinute:input.atMinute,timber:input.timber}],allocatedTimber:s.allocatedTimber+input.timber,availableTimber:s.availableTimber-input.timber});
}
