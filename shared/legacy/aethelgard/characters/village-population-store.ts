import { EALDHOLT_VILLAGE_POPULATION } from './village-population';
import { advanceVillagePopulationRuntime, createVillagePopulationRuntime, parseVillagePopulationRuntime,
  reportVillagePopulationSafetySignals,serializeVillagePopulationRuntime, type VillagePopulationRuntime, type VillagePopulationSaveOptions } from './village-population-runtime';
import type {VillageSiteLayout} from './village-site';
import type {ResidentSafetySignal} from './resident-safety';

export const VILLAGE_POPULATION_STORAGE_PREFIX = 'crownfall.ealdholt.population.v1:';
export const VILLAGE_POPULATION_CONTENT_REVISION = 'ealdholt-population-2026-11-07-v1';
export const VILLAGE_POPULATION_INTERACTIVE_ADVANCE_MINUTES = 1;
/** Saves name the authored roster by this revision instead of copying it. */
export const VILLAGE_POPULATION_SAVE_OPTIONS:VillagePopulationSaveOptions=Object.freeze({populationReference:Object.freeze({id:VILLAGE_POPULATION_CONTENT_REVISION,population:EALDHOLT_VILLAGE_POPULATION})});
/** Population saves of other worlds kept besides the current one (the desktop
 * and Quest apps name the same entry differently). Older ones are removed. */
export const VILLAGE_POPULATION_RETAINED_OTHER_WORLDS = 1;
/** `length`, `key` and `removeItem` (as on `Storage`) enable pruning of saves
 * left by superseded worlds; without them nothing is removed. */
export interface VillagePopulationStorage {
  getItem(key:string):string|null; setItem(key:string,value:string):void;
  readonly length?:number; key?(index:number):string|null; removeItem?(key:string):void;
}
function savedObservedAt(raw:string|null):number{
  if(raw===null)return -Infinity;
  try{const value=JSON.parse(raw)?.clock?.lastObservedAt;return typeof value==='number'&&Number.isFinite(value)?value:-Infinity;}catch{return -Infinity;}
}
/** Removes population saves of every world but `currentKey` and the most
 * recently observed `retain` others. Only keys under the population prefix are
 * read or removed; failures leave the remaining saves untouched. Returns the
 * removed keys. */
export function pruneVillagePopulationSaves(storage:VillagePopulationStorage,currentKey:string,retain=VILLAGE_POPULATION_RETAINED_OTHER_WORLDS):string[]{
  if(typeof storage.key!=='function'||typeof storage.removeItem!=='function'||typeof storage.length!=='number')return [];
  const others:string[]=[];
  for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key!==null&&key!==currentKey&&key.startsWith(VILLAGE_POPULATION_STORAGE_PREFIX))others.push(key);}
  if(others.length<=retain)return [];
  const ranked=others.map(key=>({key,at:savedObservedAt(storage.getItem(key))})).sort((a,b)=>b.at-a.at||(a.key<b.key?-1:1));
  const removed:string[]=[];
  for(const {key} of ranked.slice(Math.max(0,retain))){storage.removeItem(key);removed.push(key);}
  return removed;
}
export interface VillagePopulationCatchupDeadline {readonly didTimeout:boolean;timeRemaining():number}
export interface VillagePopulationCatchupTask {cancel():void}
/** schedule must defer the callback to a later idle/task turn. */
export interface VillagePopulationCatchupScheduler {
  schedule(callback:(deadline:VillagePopulationCatchupDeadline)=>void):VillagePopulationCatchupTask;
}
function defaultCatchupScheduler():VillagePopulationCatchupScheduler {
  const host=globalThis as unknown as {
    requestIdleCallback?:(callback:(deadline:VillagePopulationCatchupDeadline)=>void,options:{timeout:number})=>number;
    cancelIdleCallback?:(handle:number)=>void;
  };
  return {schedule(callback){
    if(host.requestIdleCallback&&host.cancelIdleCallback){const handle=host.requestIdleCallback(callback,{timeout:1000});return{cancel:()=>host.cancelIdleCallback!(handle)};}
    const handle=setTimeout(()=>callback({didTimeout:true,timeRemaining:()=>8}),0);
    (handle as unknown as {unref?:()=>void}).unref?.();return{cancel:()=>clearTimeout(handle)};
  }};
}
export interface VillagePopulationStore {
  readonly key:string; readonly persistence:'ready'|'memory'|'conflict'; readonly error:string|null;
  /** Saves of superseded worlds removed when this store opened. */
  readonly pruned:readonly string[];
  getSnapshot():VillagePopulationRuntime;
  /** Attach only an already validated source site; geometry never owns life. */
  attachSite(site:VillageSiteLayout|null):void;
  /** Explicit world evidence; caller must exclude Classic/replay events. */
  reportSafetySignals(signals:readonly ResidentSafetySignal[]):VillagePopulationRuntime;
  advance():VillagePopulationRuntime;
  flush():boolean;
  dispose():void;
}
/** Call only after a real inherited entry. This sidecar never reads or writes
 * the inherited-session or private-household keys. The persistent epoch makes
 * closed-page progress controlled catch-up; this is not a server simulation.
 * Pending time is drained across bounded advances, independent of cameras.
 * The synchronous baseline comparison is a best-effort stale-writer guard,
 * NOT atomic cross-tab CAS. No Web Lock or multi-tab safety proof is supplied. */
export function createVillagePopulationStore(options:{entryIdentity:string;storage:VillagePopulationStorage|null;at?:()=>number;maximumAdvanceMinutes?:number;catchupScheduler?:VillagePopulationCatchupScheduler}):VillagePopulationStore {
  const at=options.at??Date.now, worldKey=options.entryIdentity, contentRevision=VILLAGE_POPULATION_CONTENT_REVISION;
  if(typeof worldKey!=='string'||!worldKey||worldKey.length>16384)throw Error('Population needs a confirmed world identity.');
  const maximumAdvanceMinutes=options.maximumAdvanceMinutes??VILLAGE_POPULATION_INTERACTIVE_ADVANCE_MINUTES;
  if(!Number.isSafeInteger(maximumAdvanceMinutes)||maximumAdvanceMinutes<1||maximumAdvanceMinutes>10080)throw Error('Population catch-up needs an explicit bounded world-minute budget.');
  const key=VILLAGE_POPULATION_STORAGE_PREFIX+encodeURIComponent(worldKey);
  const scheduler=options.catchupScheduler??defaultCatchupScheduler();
  let storage=options.storage, persistence:'ready'|'memory'|'conflict'=storage?'ready':'memory', error:string|null=null;
  let baseline:string|null=null, disposed=false, lastFlush=at(), dirty=false,site:VillageSiteLayout|null=null;
  let catchupTask:VillagePopulationCatchupTask|null=null,catchupTicket=0,catchupError:string|null=null;
  function cancelCatchup(){catchupTicket++;const task=catchupTask;catchupTask=null;try{task?.cancel();}catch(cause){catchupError=`Population catch-up cancellation failed. ${cause instanceof Error?cause.message:String(cause)}`;}}
  const failure=(e:unknown)=>{persistence='memory';error=e instanceof Error?e.message:String(e);storage=null;};
  try { baseline=storage?.getItem(key)??null; }catch(e){failure(e);}
  const result=baseline===null?createVillagePopulationRuntime({population:EALDHOLT_VILLAGE_POPULATION,confirmedEntry:true,
    worldKey,contentRevision,createdAt:lastFlush,initialDayMinute:540,millisecondsPerWorldMinute:4000,walkingSpeedMetresPerSecond:.8})
    :parseVillagePopulationRuntime(baseline,{worldKey,contentRevision},VILLAGE_POPULATION_SAVE_OPTIONS);
  // A bad or incompatible save is held; it is never replaced with a new town.
  if(!result.ok)throw Error(result.error);
  let snapshot=result.snapshot;
  // A migrated save is dirty in memory, but read-only construction never
  // replaces the old bytes. Its next explicit/cadenced flush writes V2 with
  // the roster named by reference.
  dirty=result.migrated===true;
  // Superseded worlds' saves are removed before this world writes, so a full
  // quota left by older versions (837 KB per world) frees itself first.
  let pruned:readonly string[]=[];
  if(storage){try{pruned=Object.freeze(pruneVillagePopulationSaves(storage,key));}catch{/* Pruning is best effort; saves stay as they are. */}}
  function flush():boolean {
    if(disposed||persistence==='conflict'||!storage)return false;
    if(!dirty&&baseline!==null)return true;
    try {
      if(storage.getItem(key)!==baseline){persistence='conflict';error='Population changed in another tab; this view will not overwrite it.';cancelCatchup();return false;}
      const encoded=serializeVillagePopulationRuntime(snapshot,VILLAGE_POPULATION_SAVE_OPTIONS);if(!encoded.ok)throw Error(encoded.error);
      try{
        storage.setItem(key,encoded.json);
        if(storage.getItem(key)!==encoded.json)throw Error('Population save readback did not match.');
      }catch(cause){throw Error(`Population save could not be verified and may have committed; reload before retrying. ${cause instanceof Error?cause.message:String(cause)}`);}
      baseline=encoded.json;dirty=false;lastFlush=at();return true;
    }catch(e){failure(e);return false;}
  }
  function queueCatchup():void{
    if(disposed||persistence==='conflict'||!snapshot.clock.pendingMilliseconds){cancelCatchup();return;}
    if(catchupTask)return;
    const ticket=++catchupTicket;let scheduling=true;
    try{
      const task=scheduler.schedule(deadline=>{
        if(scheduling)throw Error('Population catch-up scheduler must defer its callback.');
        if(disposed||persistence==='conflict'||ticket!==catchupTicket)return;
        catchupTask=null;
        if(!snapshot.clock.pendingMilliseconds)return;
        try{
          if(!deadline.didTimeout&&deadline.timeRemaining()<4){queueCatchup();return;}
          advanceWithBudget(1);
        }catch(cause){catchupError=`Population catch-up paused. ${cause instanceof Error?cause.message:String(cause)}`;cancelCatchup();}
      });
      if(!task||typeof task.cancel!=='function')throw Error('Population catch-up scheduler returned no cancellation handle.');
      catchupTask=task;catchupError=null;
    }catch(cause){catchupTask=null;catchupTicket++;catchupError=`Population catch-up paused. ${cause instanceof Error?cause.message:String(cause)}`;}
    finally{scheduling=false;}
  }
  function advanceWithBudget(budget:number):VillagePopulationRuntime {
    if(disposed)throw Error('Population store is disposed.');
    const observedAt=at();
    const next=advanceVillagePopulationRuntime(snapshot,{expectedGeneration:snapshot.generation,worldKey,contentRevision,
      observedAt,maxAdvanceMinutes:budget,site});
    if(!next.ok)throw Error(next.error);
    dirty=dirty||next.snapshot!==snapshot;snapshot=next.snapshot;
    if(observedAt-lastFlush>=15000)flush();
    queueCatchup();
    return snapshot;
  }
  const advance=()=>advanceWithBudget(maximumAdvanceMinutes);
  if(baseline===null){dirty=true;flush();}
  queueCatchup();
  return {key,pruned,get persistence(){return persistence;},get error(){return error??catchupError;},getSnapshot:()=>snapshot,
    attachSite(next){
      if(disposed)throw Error('Population store is disposed.');
      if(next&&(!Object.isFrozen(next)||next.frame!=='source-root-local-metres'||!['desktop','quest'].includes(next.profile)||!/^[a-f0-9]{64}$/.test(next.sourceSha256)))throw Error('Population needs a validated frozen source site.');
      site=next;
    },reportSafetySignals(signals){
      if(disposed)throw Error('Population store is disposed.');
      const next=reportVillagePopulationSafetySignals(snapshot,{expectedGeneration:snapshot.generation,worldKey,contentRevision,signals});
      if(!next.ok)throw Error(next.error);const changed=next.snapshot!==snapshot;dirty=dirty||changed;snapshot=next.snapshot;
      // Rare meaningful evidence is flushed immediately. Repeated incident
      // IDs remain write-free; an uncertain write keeps the honest memory state.
      if(changed)flush();return snapshot;
    },advance,flush,
    dispose(){if(disposed)return;flush();disposed=true;cancelCatchup();}};
}
