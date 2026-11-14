// Host controller for the separate household sidecar. A finite authored task
// executor is not an autonomous recurring village planner. No UI or clock read.
import type { HouseholdSimulation, HouseholdCommand } from './household-simulation';
import { copyHouseholdCommandInput, type HouseholdStore, type HouseholdStoreReason, type HouseholdStoreResult } from './household-storage';
export interface HouseholdVisitSnapshot {
  readonly mode:'preview'|'inherited';readonly busy:boolean;readonly simulation:HouseholdSimulation|null;
  readonly error:string|null;readonly reason:HouseholdStoreReason|'preview'|null;readonly deferredSteps:number;
}
export interface HouseholdVisit {
  getSnapshot():HouseholdVisitSnapshot;subscribe(listener:(snapshot:HouseholdVisitSnapshot)=>void):()=>void;
  load():boolean;initialize(confirmedEntry:unknown,initial:unknown):Promise<boolean>;
  /** True means verified batches, not necessarily all debt consumed. Inspect
   * deferredSteps; the caller may schedule another bounded run. */
  catchUp():Promise<boolean>;command(command:HouseholdCommand):Promise<boolean>;dispose():void;
}
export interface HouseholdVisitOptions {
  readonly mode:'preview'|'inherited';readonly store:HouseholdStore|null;readonly at:()=>number;
  /** Must yield control rather than spin. No new batch after disposal. */
  readonly yieldControl:()=>Promise<void>;readonly maxStepsPerBatch?:number;readonly maxBatchesPerRun?:number;
}
export function createHouseholdVisit(options:HouseholdVisitOptions):HouseholdVisit {
  const {mode,at,yieldControl}=options,store=mode==='preview'?null:options.store,maxSteps=options.maxStepsPerBatch??32,maxBatches=options.maxBatchesPerRun??4;
  if(!['preview','inherited'].includes(mode)||typeof at!=='function'||typeof yieldControl!=='function'||!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>1440||!Number.isInteger(maxBatches)||maxBatches<1||maxBatches>64)throw new TypeError('Supply a caller clock, yielding scheduler and bounded household budgets.');
  let state:HouseholdVisitSnapshot=Object.freeze({mode,busy:false,simulation:null,error:null,reason:null,deferredSteps:0});
  let disposed=false,pending:{key:string;promise:Promise<boolean>}|null=null;const listeners=new Set<(s:HouseholdVisitSnapshot)=>void>();
  const debt=(s:HouseholdSimulation)=>Math.floor(s.events.world.pendingMilliseconds/s.events.world.stepMilliseconds);
  function publish(update:Partial<HouseholdVisitSnapshot>){state=Object.freeze({...state,...update});if(disposed)return;for(const listener of [...listeners]){if(disposed)break;if(listeners.has(listener))try{listener(state);}catch{/* One observer cannot change a verified commit. */}}}
  function reload():boolean {
    if(mode==='preview')return true;
    if(!store){publish({error:'Household storage needs an available exclusive browser lock.',reason:'unavailable'});return false;}
    try{const loaded=store.load();
      if(loaded.status==='invalid'){publish({error:loaded.error,reason:loaded.reason});return false;}
      publish({simulation:loaded.status==='loaded'?loaded.simulation:null,deferredSteps:loaded.status==='loaded'?debt(loaded.simulation):0,error:null,reason:null});return true;
    }catch{publish({error:'Household storage could not be read; existing saves remain in place.',reason:'unavailable'});return false;}
  }
  function accept(result:HouseholdStoreResult):boolean {
    if(disposed)return false;
    if(result.ok){publish({simulation:result.simulation,deferredSteps:result.deferredSteps,error:null,reason:null});return true;}
    // A failed write may have committed. Only a fresh read may update state;
    // the operation stays failed/uncertain until the user retries or reloads.
    reload();publish({error:result.error,reason:result.reason,...(result.deferredSteps===undefined?{}:{deferredSteps:result.deferredSteps})});return false;
  }
  function run(key:string,action:()=>Promise<boolean>):Promise<boolean>{
    if(disposed)return Promise.resolve(false);if(pending)return pending.key===key?pending.promise:Promise.resolve(false);
    if(mode==='preview'){publish({error:'Preview does not initialize or write household storage.',reason:'preview'});return Promise.resolve(false);}
    if(!store){publish({error:'Household storage needs an available exclusive browser lock.',reason:'unavailable'});return Promise.resolve(false);}
    let finish!:(ok:boolean)=>void;const owner={key,promise:new Promise<boolean>(resolve=>{finish=resolve;})};pending=owner;publish({busy:true,error:null,reason:null});
    void Promise.resolve().then(()=>disposed?false:action()).catch(()=>{if(!disposed)publish({error:'Household operation could not complete; reload before retrying.',reason:'unavailable'});return false;}).then(ok=>{
      if(pending===owner){pending=null;if(!disposed)publish({busy:false});}finish(!disposed&&ok);
    });return owner.promise;
  }
  const visit:HouseholdVisit={
    getSnapshot:()=>state,subscribe(listener){if(disposed)return()=>undefined;listeners.add(listener);return()=>{listeners.delete(listener);};},
    load(){return disposed||pending?false:reload();},
    initialize(confirmedEntry,initial){return run('initialize',async()=>accept(await store!.initialize({confirmedEntry,initial},()=>!disposed)));},
    catchUp(){return run('catch-up',async()=>{
      if(!reload()||!state.simulation){if(!state.error)publish({error:'Initialize the household explicitly after confirmed entry.',reason:'entry-required'});return false;}
      const target=at();
      for(let batch=0;batch<maxBatches;batch++){
        if(disposed)return false;const result=await store!.advance({expectedGeneration:state.simulation!.generation,observedAt:target,maxSteps},()=>!disposed);
        if(!accept(result)||disposed)return false;if(state.deferredSteps===0||batch+1===maxBatches)return true;
        await yieldControl();if(disposed)return false;
      }return true;
    });},
    command(command){
      let copy:HouseholdCommand;try{copy=copyHouseholdCommandInput(command);}catch{if(!disposed)publish({error:'Invalid household command data.',reason:'invalid-command'});return Promise.resolve(false);}
      return run(`command:${JSON.stringify(copy)}`,async()=>{
      if(!state.simulation&&!reload()||!state.simulation){publish({error:'Load an initialized household before choosing.',reason:'entry-required'});return false;}
      return accept(await store!.command({expectedGeneration:state.simulation.generation,observedAt:at(),command:copy},()=>!disposed));
    });},
    dispose(){if(disposed)return;disposed=true;listeners.clear();state=Object.freeze({...state,busy:false});},
  };
  reload();return visit;
}
