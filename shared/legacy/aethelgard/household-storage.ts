// Separate household sidecar. No migration, reset, archive or writes to any
// earlier/inherited key. Every commit replaces one complete aggregate atomically.
import { INHERITED_SESSION_STORAGE_KEY } from './inherited-storage';
import { parseInheritedSession, validateInheritedSession, type InheritedSession } from './inherited-session';
import { placeDataRecord, placeId } from './place-use';
import { advanceHouseholdSimulation, applyHouseholdCommand, ownHouseholdSimulation, parseHouseholdSimulation, serializeHouseholdSimulation,
  type HouseholdSimulation, type HouseholdCommand } from './household-simulation';
export const HOUSEHOLD_SIDECAR_STORAGE_KEY='crownfall.legacy.aethelgard.household-sidecar.v1';
export interface HouseholdStoragePort {getItem(key:string):string|null;setItem(key:string,value:string):void}
/** Must cover the ENTIRE callback across every writer. An instance-local queue
 * is not a cross-tab lock. The callback is synchronous and must run once. */
export type HouseholdExclusiveOperation=<T>(operation:()=>T)=>Promise<T>;
export type HouseholdCommitGuard=()=>boolean;
export type HouseholdStoreReason='cancelled'|'unavailable'|'entry-required'|'entry-mismatch'|'content-mismatch'|'corrupt'|'future-version'|'incompatible'|'conflict'|'verification-failed'|'catchup-required'|'invalid-command';
export interface HouseholdStoreFailure {readonly ok:false;readonly reason:HouseholdStoreReason;readonly error:string;readonly deferredSteps?:number}
export type HouseholdStoreResult={readonly ok:true;readonly status:'initialized'|'already-initialized'|'advanced'|'applied'|'already-applied';readonly simulation:HouseholdSimulation;readonly processedSteps:number;readonly deferredSteps:number}|HouseholdStoreFailure;
export type HouseholdStoreLoad={readonly status:'empty'}|{readonly status:'loaded';readonly simulation:HouseholdSimulation}|{readonly status:'invalid';readonly reason:HouseholdStoreReason;readonly error:string};
export interface HouseholdStore {
  load():HouseholdStoreLoad;
  initialize(input:{readonly confirmedEntry:unknown;readonly initial:unknown},mayCommit?:HouseholdCommitGuard):Promise<HouseholdStoreResult>;
  advance(input:{readonly expectedGeneration:number;readonly observedAt:number;readonly maxSteps:number},mayCommit?:HouseholdCommitGuard):Promise<HouseholdStoreResult>;
  command(input:{readonly expectedGeneration:number;readonly observedAt:number;readonly command:HouseholdCommand},mayCommit?:HouseholdCommitGuard):Promise<HouseholdStoreResult>;
}
/** Copy flat command data before any asynchronous lock wait. */
export function copyHouseholdCommandInput(value:unknown):HouseholdCommand {
  const c=placeDataRecord(value,['id','kind'],['taskId','knowledgeId','recipientId','sourceKnowledgeId','mode','contactPlaceId']),id=placeId(c.id);
  if(c.kind==='interrupt'||c.kind==='resume'){placeDataRecord(value,['id','kind','taskId']);return Object.freeze({id,kind:c.kind,taskId:placeId(c.taskId)});}
  placeDataRecord(value,['id','kind','knowledgeId','recipientId','sourceKnowledgeId','mode','contactPlaceId']);
  if(c.kind!=='report'||!['report','rumor'].includes(c.mode as string))throw Error('Unsupported household command.');
  return Object.freeze({id,kind:'report',knowledgeId:placeId(c.knowledgeId),recipientId:placeId(c.recipientId),sourceKnowledgeId:placeId(c.sourceKnowledgeId),mode:c.mode as 'report'|'rumor',contactPlaceId:placeId(c.contactPlaceId)});
}
interface Envelope {readonly kind:'household-sidecar';readonly schemaVersion:1;readonly entryIdentity:string;readonly contentRevision:string;readonly aggregate:HouseholdSimulation}
type Refusal=HouseholdStoreFailure;
const failure=(reason:HouseholdStoreReason,error:string,deferredSteps?:number):Refusal=>({ok:false,reason,error,...(deferredSteps===undefined?{}:{deferredSteps})});
const active=(guard?:HouseholdCommitGuard)=>{try{return guard?guard()===true:true;}catch{return false;}};
const cancelled=()=>failure('cancelled','The household owner is no longer active; its queued operation did not commit.');
const unavailable=()=>failure('unavailable','Household storage or its exclusive operation lock is unavailable. Existing bytes remain in place.');
const safe=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const identity=(session:InheritedSession)=>{const h=session.banner.heraldry;return JSON.stringify([session.house.id,session.house.nationId,session.entry.at,h.division,h.field,h.ordinary,h.ordinaryTincture,h.charge,h.chargeTincture]);};
const debt=(s:HouseholdSimulation)=>Math.floor(s.events.world.pendingMilliseconds/s.events.world.stepMilliseconds);
function parse(raw:string,revision:string):{ok:true;envelope:Envelope}|Refusal {
  try{
    const decoded=JSON.parse(raw);
    if(decoded&&typeof decoded==='object'&&decoded.kind==='household-sidecar'&&typeof decoded.schemaVersion==='number'&&decoded.schemaVersion>1)return failure('future-version','Future household sidecar; original bytes were preserved.');
    const data=placeDataRecord(decoded,['kind','schemaVersion','entryIdentity','contentRevision','aggregate']);
    if(data.kind!=='household-sidecar')return failure('incompatible','The sidecar contains another save kind; it was left untouched.');
    if(data.schemaVersion!==1)return failure(typeof data.schemaVersion==='number'&&data.schemaVersion>1?'future-version':'corrupt','Unsupported household sidecar version; no reset or migration occurred.');
    if(typeof data.entryIdentity!=='string'||typeof data.contentRevision!=='string')return failure('corrupt','Invalid household binding metadata.');
    if(data.contentRevision!==revision)return failure('content-mismatch','Household content revision changed; explicit migration is required.');
    const header=placeDataRecord(data.aggregate,['kind','schemaVersion','generation','definition','events','reservations','actors','actions','motion','commands']);
    if(typeof header.schemaVersion==='number'&&header.schemaVersion>1)return failure('future-version','Future household aggregate version; bytes were preserved.');
    const saved=parseHouseholdSimulation(JSON.stringify(data.aggregate),revision);if(!saved.ok)return failure('corrupt',saved.error);
    return{ok:true,envelope:{kind:'household-sidecar',schemaVersion:1,entryIdentity:data.entryIdentity,contentRevision:revision,aggregate:saved.snapshot}};
  }catch{return failure('corrupt','The household sidecar is invalid; its original bytes were preserved.');}
}
export function createHouseholdStore(options:{readonly storage:HouseholdStoragePort;readonly exclusive:HouseholdExclusiveOperation;readonly contentRevision:string}):HouseholdStore {
  const {storage,exclusive}=options,revision=placeId(options.contentRevision);
  if(typeof exclusive!=='function')throw new TypeError('Supply an exclusive household operation lock.');
  function entry():{ok:true;raw:string;identity:string}|Refusal {
    const raw=storage.getItem(INHERITED_SESSION_STORAGE_KEY);if(raw===null)return failure('entry-required','Confirm and save Aethelgard entry before initializing a household.');
    const parsed=parseInheritedSession(raw);return parsed.ok?{ok:true,raw,identity:identity(parsed.session)}:failure('entry-required','A valid persisted confirmed Aethelgard entry is required; inherited bytes were preserved.');
  }
  function current():{ok:true;raw:string;envelope:Envelope;entryRaw:string}|Refusal {
    const raw=storage.getItem(HOUSEHOLD_SIDECAR_STORAGE_KEY);if(raw===null)return failure('entry-required','Initialize the household explicitly after confirmed entry.');
    const loaded=parse(raw,revision);if(!loaded.ok)return loaded;const binding=entry();if(!binding.ok)return binding;
    return binding.identity===loaded.envelope.entryIdentity?{ok:true,raw,envelope:loaded.envelope,entryRaw:binding.raw}:failure('entry-mismatch','The saved household belongs to another confirmed entry; no bytes were replaced.');
  }
  function write(expected:string|null,entryRaw:string,envelope:Envelope,mayCommit?:HouseholdCommitGuard):Refusal|null {
    if(!active(mayCommit))return cancelled();
    const checked=serializeHouseholdSimulation(envelope.aggregate);if(!checked.ok)return failure('corrupt',checked.error);
    const raw=JSON.stringify(envelope);
    if(storage.getItem(HOUSEHOLD_SIDECAR_STORAGE_KEY)!==expected||storage.getItem(INHERITED_SESSION_STORAGE_KEY)!==entryRaw)return failure('conflict','Save or entry changed during the locked operation; no overwrite was attempted.');
    if(!active(mayCommit))return cancelled();
    try{storage.setItem(HOUSEHOLD_SIDECAR_STORAGE_KEY,raw);return storage.getItem(HOUSEHOLD_SIDECAR_STORAGE_KEY)===raw?null:failure('verification-failed','Household write readback did not match. Reload before retrying; no rollback/reset was attempted.');}
    catch{return failure('verification-failed','Household write could not be verified and may have committed. Reload before retrying; existing slots were not reset.');}
  }
  function success(status:Extract<HouseholdStoreResult,{ok:true}>['status'],simulation:HouseholdSimulation,processedSteps=0):HouseholdStoreResult {return{ok:true,status,simulation,processedSteps,deferredSteps:debt(simulation)};}
  async function locked(action:()=>HouseholdStoreResult,mayCommit?:HouseholdCommitGuard):Promise<HouseholdStoreResult>{try{return await exclusive(()=>active(mayCommit)?action():cancelled());}catch{return unavailable();}}
  return{
    load(){try{const raw=storage.getItem(HOUSEHOLD_SIDECAR_STORAGE_KEY);if(raw===null)return{status:'empty'};const loaded=current();return loaded.ok?{status:'loaded',simulation:loaded.envelope.aggregate}:{status:'invalid',reason:loaded.reason,error:loaded.error};}catch{const f=unavailable();return{status:'invalid',reason:f.reason,error:f.error};}},
    async initialize(input,mayCommit){
      try{
        const data=placeDataRecord(input,['confirmedEntry','initial']),problem=validateInheritedSession(data.confirmedEntry);if(problem)return failure('entry-required',problem);
        const candidate=ownHouseholdSimulation(data.initial);if(!candidate.ok)return failure('corrupt',candidate.error);
        if(candidate.snapshot.generation!==0||candidate.snapshot.actions.some(a=>a.status!=='scheduled')||candidate.snapshot.motion.length||candidate.snapshot.commands.length||candidate.snapshot.reservations.requests.length||candidate.snapshot.events.world.elapsedSteps!==0||candidate.snapshot.events.world.pendingMilliseconds!==0||candidate.snapshot.events.events.length||candidate.snapshot.events.knowledge.length||candidate.snapshot.events.decisions.length)return failure('corrupt','Explicit initialization needs a fresh household seed; progress requires a separate migration.');
        if(candidate.snapshot.definition.revision!==revision)return failure('content-mismatch','Initial household content does not match the expected revision.');
        const requested=identity(data.confirmedEntry as InheritedSession);
        return await locked(()=>{
          const binding=entry();if(!binding.ok)return binding;if(binding.identity!==requested)return failure('entry-mismatch','The supplied confirmation does not match the persisted inherited entry.');
          const raw=storage.getItem(HOUSEHOLD_SIDECAR_STORAGE_KEY);
          if(raw!==null){const existing=parse(raw,revision);if(!existing.ok)return existing;return existing.envelope.entryIdentity===binding.identity?success('already-initialized',existing.envelope.aggregate):failure('entry-mismatch','Another entry already owns this household sidecar; no reset occurred.');}
          const envelope:Envelope={kind:'household-sidecar',schemaVersion:1,entryIdentity:binding.identity,contentRevision:revision,aggregate:candidate.snapshot},refused=write(null,binding.raw,envelope,mayCommit);
          return refused??success('initialized',candidate.snapshot);
        },mayCommit);
      }catch{return failure('corrupt','Explicit household initialization data was invalid; no save was reset.');}
    },
    async advance(input,mayCommit){
      try{placeDataRecord(input,['expectedGeneration','observedAt','maxSteps']);if(!safe(input.expectedGeneration)||!safe(input.observedAt)||!safe(input.maxSteps)||input.maxSteps<1||input.maxSteps>1440)return failure('invalid-command','Supply a safe clock, generation and bounded catch-up budget.');}
      catch{return failure('invalid-command','Invalid catch-up command data.');}
      const command={expectedGeneration:input.expectedGeneration,observedAt:input.observedAt,maxSteps:input.maxSteps};
      return locked(()=>{
        const loaded=current();if(!loaded.ok)return loaded;const simulation=loaded.envelope.aggregate;
        if(command.expectedGeneration!==simulation.generation)return failure('conflict','A newer household generation exists; reload before advancing.');
        const advanced=advanceHouseholdSimulation(simulation,command);if(!advanced.ok)return failure('invalid-command',advanced.error);
        if(advanced.snapshot.generation===simulation.generation)return success('advanced',simulation,0);
        const refused=write(loaded.raw,loaded.entryRaw,{...loaded.envelope,aggregate:advanced.snapshot},mayCommit);return refused??success('advanced',advanced.snapshot,advanced.processedSteps);
      },mayCommit);
    },
    async command(input,mayCommit){
      let command:HouseholdCommand;
      try{placeDataRecord(input,['expectedGeneration','observedAt','command']);if(!safe(input.expectedGeneration)||!safe(input.observedAt))return failure('invalid-command','Supply a safe caller clock and generation.');command=copyHouseholdCommandInput(input.command);}
      catch{return failure('invalid-command','Invalid household command data.');}
      const expectedGeneration=input.expectedGeneration,observedAt=input.observedAt;
      return locked(()=>{
        const loaded=current();if(!loaded.ok)return loaded;const simulation=loaded.envelope.aggregate,w=simulation.events.world;
        if(expectedGeneration!==simulation.generation)return failure('conflict','A newer household generation exists; reload before choosing.');
        if(observedAt<w.lastObservedAt)return failure('invalid-command','Caller time moved backward; the saved world was preserved.');
        const pending=Math.floor((observedAt-w.lastSimulatedAt)/w.stepMilliseconds);
        const applied=applyHouseholdCommand(simulation,{expectedGeneration,command});
        if(!applied.ok)return pending>0?failure('catchup-required','Finish bounded catch-up before a fresh live command.',pending):failure('invalid-command',applied.error);
        if(applied.snapshot.generation===simulation.generation)return success('already-applied',simulation);
        if(pending>0)return failure('catchup-required','Finish bounded catch-up before a fresh live command.',pending);
        const refused=write(loaded.raw,loaded.entryRaw,{...loaded.envelope,aggregate:applied.snapshot},mayCommit);return refused??success('applied',applied.snapshot);
      },mayCommit);
    },
  };
}
