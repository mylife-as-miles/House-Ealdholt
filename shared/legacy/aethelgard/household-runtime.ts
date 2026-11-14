// Lazy-host bridge only. Operator content is already loaded by the host; this
// module never accepts URLs, fetches assets or reads a global clock/document.
import { placeDataRecord, placeId } from './place-use';
import { validateInheritedSession, type InheritedSession } from './inherited-session';
import { createPeopleLifeEventsSnapshot, type PeopleLifeEventModel } from './people-life-events';
import { createHouseholdSimulation, type HouseholdDefinition, type HouseholdSimulation } from './household-simulation';
import type { PeopleLifeRegistry } from './people-life';
import type { HouseholdStore } from './household-storage';
import { createHouseholdVisit, type HouseholdVisit, type HouseholdVisitSnapshot } from './household-visit';
export interface HouseholdRuntimeSeed {
  readonly kind:'household-runtime-seed';readonly schemaVersion:1;readonly contentRevision:string;
  readonly stepMilliseconds:number;readonly seed:number;readonly registry:PeopleLifeRegistry;
  readonly model:PeopleLifeEventModel;readonly definition:HouseholdDefinition;
}
export type HouseholdRuntimeSeedResult={readonly ok:true;readonly seed:HouseholdRuntimeSeed}|{readonly ok:false;readonly error:string};
function build(seed:HouseholdRuntimeSeed,startedAt:number){
  const events=createPeopleLifeEventsSnapshot(seed.registry,seed.model,{startedAt,stepMilliseconds:seed.stepMilliseconds,seed:seed.seed});
  return events.ok?createHouseholdSimulation(events.snapshot,seed.definition):events;
}
/** Validation cannot certify source geometry, actor clips or navigation. The
 * first executable pilot deliberately supports exterior service/meeting only. */
export function parseHouseholdRuntimeSeed(value:unknown):HouseholdRuntimeSeedResult {
  try{
    const d=placeDataRecord(value,['kind','schemaVersion','contentRevision','stepMilliseconds','seed','registry','model','definition']);
    if(d.kind!=='household-runtime-seed'||d.schemaVersion!==1)throw Error('Unsupported or future household runtime seed.');
    const revision=placeId(d.contentRevision),candidate=value as HouseholdRuntimeSeed,validated=build(candidate,0);if(!validated.ok)throw Error(validated.error);
    const initial=validated.snapshot;if(initial.definition.revision!==revision)throw Error('Seed and definition revisions must agree.');
    for(const task of initial.definition.tasks){
      const use=initial.definition.catalog.uses.find(u=>u.id===task.useId)!;
      if(!['service','meet'].includes(use.kind)||use.requires.some(r=>!initial.definition.catalog.resources.some(resource=>resource.id===r.resourceId&&resource.capacity===1&&r.units===1&&['stance','service'].includes(resource.kind))))throw Error('This pilot executes exterior service/standing meetings only.');
      const route=initial.definition.routes.find(r=>r.id===task.routeId)!;
      if([route.fromPlaceId,route.toPlaceId].some(id=>initial.definition.catalog.places.find(p=>p.id===id)?.kind==='workplace'))throw Error('Unqualified workplace routes are outside this pilot.');
    }
    return{ok:true,seed:Object.freeze({kind:'household-runtime-seed',schemaVersion:1,contentRevision:revision,stepMilliseconds:initial.events.world.stepMilliseconds,seed:initial.events.world.seed,registry:initial.events.registry,model:initial.events.model,definition:initial.definition})};
  }catch(cause){return{ok:false,error:cause instanceof Error?cause.message:'Invalid household runtime seed.'};}
}
export type HouseholdRuntimeTrigger='visit'|'resume'|'visible'|'retry'|'tick';
export type HouseholdRuntimePhase='disabled'|'entry-required'|'idle'|'running'|'deferred'|'ready'|'unavailable'|'suspended'|'disposed';
export interface HouseholdRuntimeSnapshot {
  readonly phase:HouseholdRuntimePhase;readonly simulation:HouseholdSimulation|null;readonly busy:boolean;
  readonly deferredSteps:number;readonly completedTasks:number;readonly totalTasks:number;readonly finite:true;
  readonly error:string|null;readonly reason:string|null;
}
export interface HouseholdRuntimeOptions {
  readonly mode:'preview'|'inherited';readonly seed:unknown|null;readonly confirmedEntry:InheritedSession|null;readonly store:HouseholdStore|null;
  readonly at:()=>number;readonly yieldControl:()=>Promise<void>;
  readonly schedule:(callback:()=>void,delayMilliseconds:number)=>(()=>void);
  readonly onState?:(snapshot:HouseholdRuntimeSnapshot)=>void;readonly maxStepsPerBatch?:number;readonly maxBatchesPerRun?:number;readonly visible?:boolean;
  /** Optional foreground executor cadence, never a recurring task planner. */
  readonly live?:boolean;
}
export interface HouseholdRuntime {
  getSnapshot():HouseholdRuntimeSnapshot;subscribe(listener:(s:HouseholdRuntimeSnapshot)=>void):()=>void;
  run(trigger:HouseholdRuntimeTrigger):Promise<boolean>;scheduleRun(trigger:HouseholdRuntimeTrigger,delayMilliseconds?:number):boolean;
  /** Visibility controls host work, never whether the persistent world ages.
   * Showing schedules one bounded run. With live:true, foreground ticks
   * continue until finite tasks finish and saved catch-up debt is consumed. */
  setVisible(visible:boolean):void;dispose():void;
}
function same(a:unknown,b:unknown):boolean {
  if(a===b)return true;if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));
  const left=Object.keys(a).sort(),right=Object.keys(b).sort();return left.length===right.length&&left.every((k,i)=>k===right[i]&&same(Object.getOwnPropertyDescriptor(a,k)?.value,Object.getOwnPropertyDescriptor(b,k)?.value));
}
export function createHouseholdRuntime(options:HouseholdRuntimeOptions):HouseholdRuntime {
  const disabled=options.mode==='preview'||options.seed==null,parsed=disabled?null:parseHouseholdRuntimeSeed(options.seed);
  const entryProblem=disabled?null:validateInheritedSession(options.confirmedEntry);
  let disposed=false,visible=options.visible??true,epoch=0,visit:HouseholdVisit|null=null,unsubscribe:(()=>void)|null=null;
  let localError:{error:string;reason:string}|null=null;
  let pending:{epoch:number;promise:Promise<boolean>}|null=null,timer:{cancel:(()=>void)|null}|null=null;
  const listeners=new Set<(s:HouseholdRuntimeSnapshot)=>void>();
  const initialPhase:HouseholdRuntimePhase=disabled?'disabled':!parsed?.ok?'unavailable':entryProblem?'entry-required':!options.store?'unavailable':visible?'idle':'suspended';
  let state:HouseholdRuntimeSnapshot=Object.freeze({phase:initialPhase,simulation:null,busy:false,deferredSteps:0,completedTasks:0,totalTasks:parsed?.ok?parsed.seed.definition.tasks.length:0,finite:true,
    error:disabled?null:!parsed?.ok?parsed?.error??'Private household seed is unavailable.':entryProblem?null:!options.store?'Exclusive household storage is unavailable.':null,
    reason:disabled?null:!parsed?.ok?'seed-invalid':entryProblem?'entry-required':!options.store?'unavailable':null});
  const enabled=()=>!disposed&&!disabled&&parsed?.ok===true&&!entryProblem&&!!options.store;
  function emit(update:Partial<HouseholdRuntimeSnapshot>){
    state=Object.freeze({...state,...update});if(disposed)return;
    for(const listener of [...listeners]){if(disposed)break;if(listeners.has(listener))try{listener(state);}catch{/* Observers cannot change a saved result. */}}
    if(!disposed)try{options.onState?.(state);}catch{/* Host presentation is not persistence authority. */}
  }
  function matches(s:HouseholdSimulation):boolean {
    return parsed?.ok===true&&s.definition.revision===parsed.seed.contentRevision&&s.events.world.stepMilliseconds===parsed.seed.stepMilliseconds&&s.events.world.seed===parsed.seed.seed
      &&same(s.definition,parsed.seed.definition)&&same(s.events.registry,parsed.seed.registry)&&same(s.events.model,parsed.seed.model);
  }
  function failLocal(error:string,reason:string){localError={error,reason};emit({phase:'unavailable',error,reason});}
  function sync(s:HouseholdVisitSnapshot){
    if(disposed||!visible)return;
    if(localError){emit({phase:'unavailable',busy:pending!==null,...localError});return;}
    if(s.simulation&&!matches(s.simulation)){failLocal('Private household content changed; explicit revision/migration is required.','content-mismatch');return;}
    const simulation=s.simulation,completedTasks=simulation?.actions.filter(a=>a.status==='completed').length??0;
    emit({simulation,busy:pending!==null,completedTasks,totalTasks:simulation?.actions.length??state.totalTasks,deferredSteps:s.deferredSteps,error:s.error,reason:s.reason,
      phase:s.error?'unavailable':pending?'running':s.deferredSteps>0?'deferred':simulation?'ready':'idle'});
  }
  function stopVisit(){unsubscribe?.();unsubscribe=null;visit?.dispose();visit=null;}
  function cancelTimer(){const owner=timer;timer=null;try{owner?.cancel?.();}catch{/* It remains invalidated even if the host cancellation throws. */}}
  function attach():HouseholdVisit {
    if(visit)return visit;
    const owner=createHouseholdVisit({mode:'inherited',store:options.store,at:options.at,yieldControl:options.yieldControl,maxStepsPerBatch:options.maxStepsPerBatch,maxBatchesPerRun:options.maxBatchesPerRun});
    visit=owner;unsubscribe=owner.subscribe(snapshot=>{if(visit===owner)sync(snapshot);});return owner;
  }
  const runtime:HouseholdRuntime={
    getSnapshot:()=>state,subscribe(listener){if(disposed)return()=>undefined;listeners.add(listener);return()=>{listeners.delete(listener);};},
    run(trigger){
      if(!enabled()||!visible||!['visit','resume','visible','retry','tick'].includes(trigger))return Promise.resolve(false);
      cancelTimer();if(pending)return pending.promise;
      localError=null;
      const current=++epoch;let finish!:(ok:boolean)=>void;const owner={epoch:current,promise:new Promise<boolean>(resolve=>{finish=resolve;})};pending=owner;
      emit({phase:'running',busy:true,error:null,reason:null});
      void Promise.resolve().then(async()=>{
        if(disposed||!visible||epoch!==current)return false;const inner=attach();
        if(!inner.load()){sync(inner.getSnapshot());return false;}
        let saved=inner.getSnapshot().simulation;
        if(saved&&!matches(saved)){sync(inner.getSnapshot());return false;}
        if(!saved){
          // No time comes from the private file. A restored world is never
          // rebuilt/reseeded; this start instant is sampled once for creation.
          const initial=build((parsed as Extract<HouseholdRuntimeSeedResult,{ok:true}>).seed,options.at());
          if(!initial.ok){failLocal(initial.error,'seed-invalid');return false;}
          if(disposed||!visible||epoch!==current)return false;
          if(!await inner.initialize(options.confirmedEntry,initial.snapshot))return false;
          saved=inner.getSnapshot().simulation;
        }
        if(disposed||!visible||epoch!==current||!saved)return false;
        return inner.catchUp();
      }).catch(()=>{if(!disposed&&epoch===current)failLocal('Household runtime could not finish its bounded operation.','unavailable');return false;}).then(ok=>{
        if(pending===owner){
          pending=null;if(!disposed&&visible&&epoch===current){
            if(visit)sync(visit.getSnapshot());else emit({busy:false});
            // One completed bounded run owns at most one later foreground tick.
            // Stop on errors/hidden hosts, or once finite tasks and time debt finish.
            if(ok&&options.live===true&&enabled()&&visible&&!state.error&&(state.deferredSteps>0||state.totalTasks>state.completedTasks)&&parsed?.ok)
              runtime.scheduleRun('tick',Math.min(60000,Math.max(1000,parsed.seed.stepMilliseconds)));
          }
        }
        finish(!disposed&&visible&&epoch===current&&ok);
      });return owner.promise;
    },
    scheduleRun(trigger,delayMilliseconds=0){
      if(!enabled()||!visible||pending||timer||!['visit','resume','visible','retry','tick'].includes(trigger)||!Number.isSafeInteger(delayMilliseconds)||delayMilliseconds<0||delayMilliseconds>60000)return false;
      const owner:{cancel:(()=>void)|null}={cancel:null};timer=owner;
      try{owner.cancel=options.schedule(()=>{if(timer!==owner||disposed||!visible)return;timer=null;void runtime.run(trigger);},delayMilliseconds);return true;}
      catch{if(timer===owner)timer=null;failLocal('The household one-shot scheduler is unavailable.','unavailable');return false;}
    },
    setVisible(next){
      if(disposed||typeof next!=='boolean'||next===visible)return;visible=next;
      if(!visible){epoch++;pending=null;cancelTimer();stopVisit();if(!disabled)emit({phase:'suspended',busy:false});}
      else if(enabled()){emit({phase:'idle',busy:false});runtime.scheduleRun('visible');}
    },
    dispose(){if(disposed)return;disposed=true;visible=false;epoch++;pending=null;cancelTimer();stopVisit();listeners.clear();state=Object.freeze({...state,phase:'disposed',busy:false});},
  };
  return runtime;
}
