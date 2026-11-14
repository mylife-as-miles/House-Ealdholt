// Pure, separate experiment aggregate. Routes below are authored abstract
// durations, NOT Elderbloom navigation/clearance, rendered arrival or LOS proof.
// A generation check is domain CAS only: a future storage adapter must serialize
// writers and commit this ENTIRE aggregate atomically. No storage is accessed.
import { placeDataArray, placeDataRecord, placeId, parsePlaceUseCatalog, canAccessPlaceUse, isPlaceUseOpen, type PlaceUseCatalog } from './place-use';
import { createPlaceReservationBook, parsePlaceReservationBook, reconcilePlaceReservations, requestPlaceUse, cancelPlaceUse, releasePlaceUse, type PlaceReservationBook } from './reservations';
import { catchUpPeopleLifeEvents, ownPeopleLifeEventsSnapshot, getPeopleLifeEventsRegistry, recordPeopleLifeOccurrence, transmitPeopleLifeKnowledge, type PeopleLifeEventsSnapshot, type PeopleLifeFactEffect } from './people-life-events';

export interface HouseholdRoute { readonly id:string; readonly fromPlaceId:string; readonly toPlaceId:string; readonly travelMinutes:number }
export interface HouseholdTask {
  readonly id:string; readonly residentId:string; readonly routeId:string; readonly useId:string;
  readonly startsAt:number; readonly workMinutes:number;
  readonly completion:{ readonly eventId:string; readonly typeId:string; readonly effects:readonly PeopleLifeFactEffect[];
    /** Authored observation opportunities; only actually present actors qualify. */
    readonly witnesses:readonly {readonly residentId:string; readonly knowledgeId:string}[] };
}
export interface HouseholdDefinition {
  readonly revision:string; readonly proof:'abstract-route-fixture'; readonly catalog:PlaceUseCatalog;
  readonly routes:readonly HouseholdRoute[]; readonly tasks:readonly HouseholdTask[];
  /** Explicit initial endpoint evidence, never a projected routine. */
  readonly initialPlaces:readonly {readonly residentId:string; readonly placeId:string}[];
}
export type HouseholdActionStatus='scheduled'|'travelling'|'queued'|'working'|'interrupted'|'completed';
export interface HouseholdAction {
  readonly id:string; readonly status:HouseholdActionStatus; readonly routeProgress:number; readonly workProgress:number;
  readonly leaseAttempt:number; readonly reservationId:string|null; readonly completedAt:number|null;
}
export interface HouseholdActor { readonly residentId:string; readonly placeId:string|null; readonly actionId:string|null }
export interface HouseholdMotion {readonly taskId:string;readonly kind:'depart'|'arrive';readonly atMinute:number}
export type HouseholdCommand =
  | {readonly id:string; readonly kind:'interrupt'|'resume'; readonly taskId:string}
  | {readonly id:string; readonly kind:'report'; readonly knowledgeId:string; readonly recipientId:string;
      readonly sourceKnowledgeId:string; readonly mode:'report'|'rumor'; readonly contactPlaceId:string};
export interface HouseholdCommandRecord {
  readonly command:HouseholdCommand; readonly atMinute:number;
  /** Derived from actor endpoints at command time, never from routines. */
  readonly contact:{readonly senderId:string;readonly recipientId:string;readonly placeId:string}|null;
}
export interface HouseholdSimulation {
  readonly kind:'household-simulation-experiment'; readonly schemaVersion:1; readonly generation:number;
  readonly definition:HouseholdDefinition; readonly events:PeopleLifeEventsSnapshot; readonly reservations:PlaceReservationBook;
  readonly actors:readonly HouseholdActor[]; readonly actions:readonly HouseholdAction[];
  /** Authoritative abstract endpoint transitions, retained for contact replay. */
  readonly motion:readonly HouseholdMotion[];
  readonly commands:readonly HouseholdCommandRecord[];
}
export type HouseholdSimulationResult={readonly ok:true; readonly snapshot:HouseholdSimulation}|{readonly ok:false; readonly error:string};
export type HouseholdAdvanceResult={readonly ok:true;readonly snapshot:HouseholdSimulation;readonly processedSteps:number;readonly deferredSteps:number}|{readonly ok:false;readonly error:string};
type Mutable<T>={-readonly [K in keyof T]:T[K]};
type Working=Omit<Mutable<HouseholdSimulation>,'actors'|'actions'|'commands'|'motion'> & {
  actors:Mutable<HouseholdActor>[]; actions:Mutable<HouseholdAction>[]; commands:HouseholdCommandRecord[];motion:HouseholdMotion[];
};
const safe=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const num=(v:unknown,positive=false):number=>{if(!safe(v)||(positive&&v===0))throw Error('Expected a safe nonnegative integer.');return v;};
const fail=(error:string):{readonly ok:false;readonly error:string}=>({ok:false,error});
function own<T>(v:T):T {
  if(Array.isArray(v))return Object.freeze(v.map(own)) as T;
  if(v!==null&&typeof v==='object')return Object.freeze(Object.fromEntries(Object.getOwnPropertyNames(v).map(k=>[k,own(Object.getOwnPropertyDescriptor(v,k)!.value)]))) as T;
  return v;
}
function same(a:unknown,b:unknown):boolean {
  if(a===b)return true;if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));
  const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&same(Object.getOwnPropertyDescriptor(a,k)?.value,Object.getOwnPropertyDescriptor(b,k)?.value));
}
const unique=(ids:readonly string[])=>{if(new Set(ids).size!==ids.length)throw Error('Duplicate household identity.');};
const compareId=(a:string,b:string)=>a<b?-1:a>b?1:0;
const leaseId=(taskId:string,attempt:number)=>placeId(`${taskId}:lease:${attempt}`);
function definition(value:unknown,events:PeopleLifeEventsSnapshot):HouseholdDefinition {
  const d=placeDataRecord(value,['revision','proof','catalog','routes','tasks','initialPlaces']);
  const revision=placeId(d.revision);if(d.proof!=='abstract-route-fixture')throw Error('Only abstract route fixture evidence is supported.');
  const parsed=parsePlaceUseCatalog(d.catalog);if(!parsed.ok)throw Error(parsed.error);const catalog=parsed.value;
  const registry=getPeopleLifeEventsRegistry(events),people=new Set(registry.residents.map(r=>r.id)),places=new Set(registry.places.map(p=>p.id));
  if(catalog.residents.length!==people.size||catalog.residents.some(r=>!people.has(r.id)||registry.residents.find(p=>p.id===r.id)!.homeHouseholdId!==r.householdId)
    ||catalog.places.length!==places.size||catalog.places.some(p=>!places.has(p.id))
    ||catalog.households.length!==registry.households.length||catalog.households.some(h=>!registry.households.some(r=>r.id===h.id&&r.homePlaceId===h.homePlaceId)))throw Error('Life and place registries must agree.');
  const routes=placeDataArray(d.routes).map(v=>{const r=placeDataRecord(v,['id','fromPlaceId','toPlaceId','travelMinutes']);
    const route={id:placeId(r.id),fromPlaceId:placeId(r.fromPlaceId),toPlaceId:placeId(r.toPlaceId),travelMinutes:num(r.travelMinutes,true)};
    if(!places.has(route.fromPlaceId)||!places.has(route.toPlaceId))throw Error('Route endpoints must be registered.');return route;});unique(routes.map(r=>r.id));
  const initialPlaces=placeDataArray(d.initialPlaces).map(v=>{const r=placeDataRecord(v,['residentId','placeId']);const item={residentId:placeId(r.residentId),placeId:placeId(r.placeId)};
    if(!people.has(item.residentId)||!places.has(item.placeId))throw Error('Initial actor endpoints must be explicit registered places.');return item;});
  unique(initialPlaces.map(p=>p.residentId));if(initialPlaces.length!==people.size)throw Error('Every resident needs explicit initial location evidence.');
  const tasks=placeDataArray(d.tasks).map(v=>{const t=placeDataRecord(v,['id','residentId','routeId','useId','startsAt','workMinutes','completion']);
    const id=placeId(t.id),residentId=placeId(t.residentId),routeId=placeId(t.routeId),useId=placeId(t.useId),c=placeDataRecord(t.completion,['eventId','typeId','effects','witnesses']);
    if(id.length>64||!people.has(residentId))throw Error('Tasks need a registered resident and bounded stable ID.');
    const route=routes.find(r=>r.id===routeId),use=catalog.uses.find(u=>u.id===useId),type=events.model.eventTypes.find(e=>e.id===c.typeId);
    if(!route||!use||route.toPlaceId!==use.placeId||!type||!canAccessPlaceUse(catalog,residentId,useId))throw Error('Tasks need an accessible route/use and registered event type.');
    const effects=placeDataArray(c.effects).map(v=>{const e=placeDataRecord(v,['factId','value']);if(typeof e.value!=='boolean'||!type.factIds.includes(placeId(e.factId)))throw Error('Unregistered task fact effect.');return{factId:e.factId as string,value:e.value};});unique(effects.map(e=>e.factId));
    const witnesses=placeDataArray(c.witnesses).map(v=>{const w=placeDataRecord(v,['residentId','knowledgeId']);const residentId=placeId(w.residentId),knowledgeId=placeId(w.knowledgeId);if(!people.has(residentId))throw Error('Unregistered observation opportunity.');return{residentId,knowledgeId};});unique(witnesses.map(w=>w.residentId));unique(witnesses.map(w=>w.knowledgeId));
    const startsAt=num(t.startsAt),workMinutes=num(t.workMinutes,true);num(startsAt+route.travelMinutes+workMinutes);
    return{id,residentId,routeId,useId,startsAt,workMinutes,completion:{eventId:placeId(c.eventId),typeId:type.id,effects,witnesses}};
  });unique(tasks.map(t=>t.id));unique(tasks.map(t=>t.completion.eventId));unique(tasks.flatMap(t=>t.completion.witnesses.map(w=>w.knowledgeId)));
  return own({revision,proof:'abstract-route-fixture',catalog,routes,tasks,initialPlaces});
}
function command(value:unknown):HouseholdCommand {
  const c=placeDataRecord(value,['id','kind'],['taskId','knowledgeId','recipientId','sourceKnowledgeId','mode','contactPlaceId']);
  const id=placeId(c.id);
  if(c.kind==='interrupt'||c.kind==='resume'){placeDataRecord(value,['id','kind','taskId']);return{id,kind:c.kind,taskId:placeId(c.taskId)};}
  if(c.kind!=='report'||!['report','rumor'].includes(c.mode as string))throw Error('Unsupported household command.');
  placeDataRecord(value,['id','kind','knowledgeId','recipientId','sourceKnowledgeId','mode','contactPlaceId']);
  return{id,kind:'report',knowledgeId:placeId(c.knowledgeId),recipientId:placeId(c.recipientId),sourceKnowledgeId:placeId(c.sourceKnowledgeId),mode:c.mode as 'report'|'rumor',contactPlaceId:placeId(c.contactPlaceId)};
}
/** Validate both domains AND the links between them before accepting a restore. */
export function validateHouseholdSimulation(value:unknown):string|null {
  try{
    const s=placeDataRecord(value,['kind','schemaVersion','generation','definition','events','reservations','actors','actions','motion','commands']);
    if(s.kind!=='household-simulation-experiment'||s.schemaVersion!==1)throw Error('Unsupported or future household snapshot.');num(s.generation);
    const life=ownPeopleLifeEventsSnapshot(s.events);if(!life.ok)throw Error(life.error);const events=life.snapshot,d=definition(s.definition,events),minute=events.world.elapsedSteps;
    const book=parsePlaceReservationBook(s.reservations,d.catalog);if(!book.ok)throw Error(book.error);if(book.value.lastWorldMinute!==minute)throw Error('Reservation and life clocks must agree exactly.');
    const actors=placeDataArray(s.actors).map(v=>{const a=placeDataRecord(v,['residentId','placeId','actionId']);return{residentId:placeId(a.residentId),placeId:a.placeId===null?null:placeId(a.placeId),actionId:a.actionId===null?null:placeId(a.actionId)};});
    unique(actors.map(a=>a.residentId));if(actors.length!==d.initialPlaces.length||actors.some(a=>!d.initialPlaces.some(p=>p.residentId===a.residentId)||a.placeId!==null&&!d.catalog.places.some(p=>p.id===a.placeId)))throw Error('Invalid actor endpoints.');
    const actions=placeDataArray(s.actions).map(v=>{const a=placeDataRecord(v,['id','status','routeProgress','workProgress','leaseAttempt','reservationId','completedAt']);
      if(!['scheduled','travelling','queued','working','interrupted','completed'].includes(a.status as string))throw Error('Invalid action phase.');
      return{id:placeId(a.id),status:a.status as HouseholdActionStatus,routeProgress:num(a.routeProgress),workProgress:num(a.workProgress),leaseAttempt:num(a.leaseAttempt),reservationId:a.reservationId===null?null:placeId(a.reservationId),completedAt:a.completedAt===null?null:num(a.completedAt)};});
    unique(actions.map(a=>a.id));if(actions.length!==d.tasks.length)throw Error('Every authored task needs exactly one progress record.');
    const records=placeDataArray(s.commands).map(v=>{const r=placeDataRecord(v,['command','atMinute','contact']),c=command(r.command),atMinute=num(r.atMinute);if(atMinute>minute)throw Error('Command cannot precede its world clock.');return{command:c,atMinute,contact:r.contact};});
    unique(records.map(r=>r.command.id));if(records.some((r,i)=>i>0&&r.atMinute<records[i-1].atMinute))throw Error('Commands must preserve chronological order.');
    const motion=placeDataArray(s.motion).map(v=>{const r=placeDataRecord(v,['taskId','kind','atMinute']);if(!['depart','arrive'].includes(r.kind as string)||num(r.atMinute)>minute)throw Error('Invalid motion evidence.');return{taskId:placeId(r.taskId),kind:r.kind as 'depart'|'arrive',atMinute:r.atMinute as number};});
    unique(motion.map(m=>`${m.taskId}:${m.kind}`));if(motion.some((m,i)=>i>0&&m.atMinute<motion[i-1].atMinute))throw Error('Motion must preserve chronological order.');
    const endpoint=new Map(d.initialPlaces.map(p=>[p.residentId,p.placeId as string|null])),transit=new Map<string,HouseholdMotion>(),lastTask=new Map<string,string>();
    const travelled=(taskId:string,departure:number,until:number)=>{
      let pausedAt:number|null=null,paused=0;
      for(const r of records)if(r.command.kind!=='report'&&r.command.taskId===taskId&&r.atMinute>=departure&&r.atMinute<=until){
        if(r.command.kind==='interrupt'){if(pausedAt!==null)throw Error('Repeated interruption cannot fabricate travel time.');pausedAt=r.atMinute;}
        else{if(pausedAt===null)throw Error('Resume requires an actual interruption.');paused+=r.atMinute-pausedAt;pausedAt=null;}
      }
      return until-departure-paused-(pausedAt===null?0:until-pausedAt);
    };
    for(const m of motion){
      const task=d.tasks.find(t=>t.id===m.taskId),progress=actions.find(a=>a.id===m.taskId);if(!task||!progress||progress.status==='scheduled')throw Error('Motion needs a started authored task.');const route=d.routes.find(r=>r.id===task.routeId)!;
      if(m.kind==='depart'){
        const previous=actions.find(a=>a.id===lastTask.get(task.residentId));
        if(m.atMinute<task.startsAt||endpoint.get(task.residentId)!==route.fromPlaceId||transit.has(task.residentId)||previous&&(previous.completedAt===null||previous.completedAt>m.atMinute))throw Error('Departure requires the actual previous endpoint and completed prior action.');
        endpoint.set(task.residentId,null);transit.set(task.residentId,m);
      }else{
        const departure=transit.get(task.residentId);if(!departure||departure.taskId!==task.id||travelled(task.id,departure.atMinute,m.atMinute)!==route.travelMinutes)throw Error('Arrival must replay its full unpaused route duration.');
        endpoint.set(task.residentId,route.toPlaceId);transit.delete(task.residentId);lastTask.set(task.residentId,task.id);
      }
    }
    for(const a of actions){const task=d.tasks.find(t=>t.id===a.id);if(!task)throw Error('Unknown motion task.');const route=d.routes.find(r=>r.id===task.routeId)!,departure=motion.find(m=>m.taskId===a.id&&m.kind==='depart'),arrival=motion.find(m=>m.taskId===a.id&&m.kind==='arrive');
      if(a.status==='scheduled'&&(departure||arrival)||a.status!=='scheduled'&&!departure||a.routeProgress===route.travelMinutes&&!arrival||a.routeProgress<route.travelMinutes&&arrival)throw Error('Progress must retain its exact departure/arrival evidence.');
      if(departure&&!arrival&&travelled(a.id,departure.atMinute,minute)!==a.routeProgress)throw Error('Transit progress must replay its interrupted route.');
      if(a.completedAt!==null&&arrival&&a.completedAt<arrival.atMinute+task.workMinutes)throw Error('Completion must follow arrival and sustained work.');
    }
    for(const a of actors)if(endpoint.get(a.residentId)!==a.placeId)throw Error('Current endpoint must replay the motion journal.');
    const endpointAt=(residentId:string,at:number,beforeDepartures=false)=>{let place:string|null=d.initialPlaces.find(p=>p.residentId===residentId)?.placeId??null;for(const m of motion){const t=d.tasks.find(t=>t.id===m.taskId)!;if(t.residentId===residentId&&m.atMinute<=at&&!(beforeDepartures&&m.kind==='depart'&&m.atMinute===at))place=m.kind==='depart'?null:d.routes.find(r=>r.id===t.routeId)!.toPlaceId;}return place;};
    const linked=new Set<string>();
    for(const a of actions){
      const task=d.tasks.find(t=>t.id===a.id);if(!task)throw Error('Unknown action progress.');const route=d.routes.find(r=>r.id===task.routeId)!,actor=actors.find(p=>p.residentId===task.residentId)!;
      if(a.routeProgress>route.travelMinutes||a.workProgress>task.workMinutes||a.completedAt!==null&&a.completedAt>minute)throw Error('Action progress exceeds its authored work or clock.');
      if(a.leaseAttempt>book.value.requests.length)throw Error('Lease attempt exceeds the saved request ledger.');
      if(a.reservationId!==(a.leaseAttempt?leaseId(a.id,a.leaseAttempt):null))throw Error('Action lease identity disagrees with attempt.');
      for(let i=1;i<=a.leaseAttempt;i++){const rid=leaseId(a.id,i),r=book.value.requests.find(r=>r.id===rid);if(!r||r.residentId!==task.residentId||r.useId!==task.useId||i<a.leaseAttempt&&!['cancelled','released'].includes(r.status))throw Error('Action reservations must preserve every prior terminal attempt.');linked.add(rid);}
      const lease=book.value.requests.find(r=>r.id===a.reservationId),event=events.events.find(e=>e.id===task.completion.eventId);
      if(a.status==='completed'){
        if(a.routeProgress!==route.travelMinutes||a.workProgress!==task.workMinutes||a.completedAt===null||!event||event.atStep!==a.completedAt||event.typeId!==task.completion.typeId
          ||!same(event.actorIds,[task.residentId])||!same(event.effects,task.completion.effects)||event.placeId!==route.toPlaceId||lease?.status!=='released')throw Error('Completed work needs its exact occurred event and released lease.');
        if(a.completedAt<task.startsAt+route.travelMinutes+task.workMinutes)throw Error('Completion cannot precede travel and sustained work.');
        if(event.witnesses.some(w=>!task.completion.witnesses.some(x=>same(w,x))))throw Error('Completion grants only authored observation opportunities.');
        if(event.presence.some(p=>endpointAt(p.residentId,event.atStep,true)!==p.placeId))throw Error('Completion presence must replay actual abstract endpoint history.');
      }else{
        if(a.completedAt!==null||event)throw Error('Intention cannot masquerade as a completed event.');
        if(a.status==='scheduled'){if(a.routeProgress||a.workProgress||a.leaseAttempt)throw Error('Unstarted task cannot own progress or claims.');continue;}
        if(minute<task.startsAt+a.routeProgress+a.workProgress||a.status!=='working'&&a.workProgress!==0||a.status==='working'&&a.workProgress===task.workMinutes)throw Error('Live work must fit its phase and authoritative minute.');
        if(actor.actionId!==a.id)throw Error('An active task must own its actor.');
        const arrived=a.routeProgress===route.travelMinutes;
        if(actor.placeId!==(arrived?route.toPlaceId:null))throw Error('Actor endpoint disagrees with authoritative route progress.');
        if(!arrived&&a.leaseAttempt||arrived&&a.status==='interrupted'&&!lease)throw Error('Resource attempt requires recorded arrival.');
        if(a.status==='travelling'&&(arrived||a.leaseAttempt||a.workProgress))throw Error('Travel cannot reserve resources or complete work.');
        if((a.status==='queued'||a.status==='working')&&(!arrived||!lease||!['held','queued'].includes(lease.status)))throw Error('Onsite action requires its live reservation.');
        if(a.status==='working'&&(lease?.status!=='held'||!isPlaceUseOpen(d.catalog,task.useId,minute)))throw Error('Working requires an open held bundle.');
        if(a.status==='interrupted'&&(a.workProgress||lease&&['queued','held'].includes(lease.status)))throw Error('Interruption must reset work and release claims.');
      }
    }
    if(book.value.requests.some(r=>!linked.has(r.id)))throw Error('Orphan reservation outside the action aggregate.');
    for(const actor of actors){
      const owned=actions.filter(a=>d.tasks.find(t=>t.id===a.id)!.residentId===actor.residentId),active=owned.filter(a=>!['scheduled','completed'].includes(a.status));
      if(active.length>1||actor.actionId!==(active[0]?.id??null)||actor.placeId===null&&!active.length)throw Error('An actor has conflicting action ownership.');
      let endpoint=d.initialPlaces.find(p=>p.residentId===actor.residentId)!.placeId,previousAt=0;
      for(const completed of owned.filter(a=>a.status==='completed').sort((a,b)=>a.completedAt!-b.completedAt!||compareId(a.id,b.id))){
        const task=d.tasks.find(t=>t.id===completed.id)!,route=d.routes.find(r=>r.id===task.routeId)!;
        if(route.fromPlaceId!==endpoint||completed.completedAt!<Math.max(task.startsAt,previousAt)+route.travelMinutes+task.workMinutes)throw Error('Completed routes must form a physically ordered endpoint history.');
        endpoint=route.toPlaceId;previousAt=completed.completedAt!;
      }
      if(active.length){const task=d.tasks.find(t=>t.id===active[0].id)!,route=d.routes.find(r=>r.id===task.routeId)!;if(route.fromPlaceId!==endpoint||minute<Math.max(task.startsAt,previousAt)+active[0].routeProgress+active[0].workProgress)throw Error('Active route cannot teleport from the previous endpoint.');}
      else if(actor.placeId!==endpoint)throw Error('Idle endpoint requires initial or completed-route evidence.');
    }
    const commands=records.map(r=>{
      const c=r.command,atMinute=r.atMinute;
      if(c.kind==='report'){
        const contact=placeDataRecord(r.contact,['senderId','recipientId','placeId']),source=events.knowledge.find(k=>k.id===c.sourceKnowledgeId);
        if(!source||source.atStep>atMinute||contact.senderId!==source.residentId||contact.recipientId!==c.recipientId||contact.placeId!==c.contactPlaceId
          ||!actors.some(a=>a.residentId===c.recipientId)||!d.catalog.places.some(p=>p.id===contact.placeId))throw Error('Saved report needs explicit source/contact evidence.');
        if(endpointAt(source.residentId,atMinute)!==contact.placeId||endpointAt(c.recipientId,atMinute)!==contact.placeId)throw Error('Report contact must replay both historical endpoints.');
        const delivered=events.knowledge.some(k=>k.eventId===source.eventId&&k.residentId===c.recipientId&&k.atStep<=atMinute&&(k.mode===c.mode||k.mode==='witness'||k.mode==='report'));
        if(!delivered)throw Error('Saved report requires its actual delivered or already-known evidence.');
      }else if(r.contact!==null||!d.tasks.some(t=>t.id===c.taskId))throw Error('Saved action command references an unknown task or fabricated contact.');
      return c;
    });unique(commands.map(c=>c.id));
    return null;
  }catch(cause){return cause instanceof Error?cause.message:'Invalid household simulation.';}
}
export function ownHouseholdSimulation(value:unknown):HouseholdSimulationResult {
  const error=validateHouseholdSimulation(value);return error?fail(error):{ok:true,snapshot:own(value as HouseholdSimulation)};
}
export function createHouseholdSimulation(events:PeopleLifeEventsSnapshot,input:unknown):HouseholdSimulationResult {
  const life=ownPeopleLifeEventsSnapshot(events);if(!life.ok)return life;
  try{const d=definition(input,life.snapshot);return ownHouseholdSimulation({kind:'household-simulation-experiment',schemaVersion:1,generation:0,definition:d,events:life.snapshot,
    reservations:createPlaceReservationBook(events.world.elapsedSteps),actors:d.initialPlaces.map(p=>({...p,actionId:null})),actions:d.tasks.map(t=>({id:t.id,status:'scheduled',routeProgress:0,workProgress:0,leaseAttempt:0,reservationId:null,completedAt:null})),motion:[],commands:[]});}
  catch(cause){return fail(cause instanceof Error?cause.message:'Invalid household definition.');}
}
function working(s:HouseholdSimulation):Working{return{...s,actors:s.actors.map(a=>({...a})),actions:s.actions.map(a=>({...a})),commands:[...s.commands],motion:[...s.motion]};}
function useResult(s:Working,result:ReturnType<typeof reconcilePlaceReservations>):void{if(!result.ok)throw Error(result.error);s.reservations=result.value;}
function request(s:Working,a:Mutable<HouseholdAction>,task:HouseholdTask):void {
  a.leaseAttempt++;a.reservationId=leaseId(a.id,a.leaseAttempt);useResult(s,requestPlaceUse(s.definition.catalog,s.reservations,{id:a.reservationId,residentId:task.residentId,useId:task.useId},s.events.world.elapsedSteps));a.status='queued';
}
function interrupt(s:Working,a:Mutable<HouseholdAction>):void {
  if(a.status==='scheduled'||a.status==='completed'||a.status==='interrupted')throw Error('Only a live action can be interrupted.');
  if(a.reservationId)useResult(s,cancelPlaceUse(s.definition.catalog,s.reservations,a.reservationId,s.events.world.elapsedSteps));a.workProgress=0;a.status='interrupted';
}
function promote(s:Working):void {for(const a of s.actions)if(a.status==='queued'&&s.reservations.requests.some(r=>r.id===a.reservationId&&r.status==='held'))a.status='working';}
function tick(s:Working):void {
  const minute=s.events.world.elapsedSteps,d=s.definition;useResult(s,reconcilePlaceReservations(d.catalog,s.reservations,minute));
  for(const a of [...s.actions].sort((a,b)=>compareId(a.id,b.id))){
    const task=d.tasks.find(t=>t.id===a.id)!,route=d.routes.find(r=>r.id===task.routeId)!,actor=s.actors.find(p=>p.residentId===task.residentId)!;
    if(a.status==='travelling'){a.routeProgress++;if(a.routeProgress===route.travelMinutes){actor.placeId=route.toPlaceId;s.motion.push({taskId:a.id,kind:'arrive',atMinute:minute});request(s,a,task);}}
    else if(a.status==='working'){
      if(!isPlaceUseOpen(d.catalog,task.useId,minute)){interrupt(s,a);continue;}
      a.workProgress++;if(a.workProgress===task.workMinutes){
        const presence=s.actors.filter(p=>p.placeId!==null).map(p=>({residentId:p.residentId,placeId:p.placeId!}));
        const witnesses=task.completion.witnesses.filter(w=>presence.some(p=>p.residentId===w.residentId&&p.placeId===route.toPlaceId));
        const event=recordPeopleLifeOccurrence(s.events,{id:task.completion.eventId,typeId:task.completion.typeId,atStep:minute,actorIds:[task.residentId],placeId:route.toPlaceId,effects:task.completion.effects,presence,witnesses});
        if(!event.ok)throw Error(event.error);s.events=event.snapshot;useResult(s,releasePlaceUse(d.catalog,s.reservations,a.reservationId!,minute));a.status='completed';a.completedAt=minute;actor.actionId=null;
      }
    }
  }
  promote(s);
  // Stable explicit task order, not array/render order or unrelated randomness.
  for(const task of [...d.tasks].sort((a,b)=>a.startsAt-b.startsAt||compareId(a.id,b.id))){
    const a=s.actions.find(a=>a.id===task.id)!,actor=s.actors.find(p=>p.residentId===task.residentId)!,route=d.routes.find(r=>r.id===task.routeId)!;
    if(a.status==='scheduled'&&task.startsAt<=minute&&actor.actionId===null&&actor.placeId===route.fromPlaceId){actor.actionId=a.id;actor.placeId=null;a.status='travelling';s.motion.push({taskId:a.id,kind:'depart',atMinute:minute});}
  }
}
/** Each bounded minute includes the action transition before another minute.
 * No Date/timers/renderer/visibility dependency. Pending time remains explicit. */
export function advanceHouseholdSimulation(snapshot:HouseholdSimulation,input:{readonly expectedGeneration:number;readonly observedAt:number;readonly maxSteps:number}):HouseholdAdvanceResult {
  const checked=ownHouseholdSimulation(snapshot);if(!checked.ok)return checked;
  try{
    placeDataRecord(input,['expectedGeneration','observedAt','maxSteps']);num(input.expectedGeneration);num(input.observedAt);if(num(input.maxSteps,true)>1440)throw Error('Catch-up budget exceeds one bounded day.');
    if(input.expectedGeneration!==snapshot.generation)return fail('Stale household writer generation.');
    const s=working(checked.snapshot);let processedSteps=0;
    while(processedSteps<input.maxSteps){
      const result=catchUpPeopleLifeEvents(s.events,input.observedAt,1);if(!result.ok)throw Error(result.error);
      const changed=!same(result.snapshot,s.events);s.events=result.snapshot;if(!result.processedSteps){if(changed)s.generation++;break;}
      tick(s);processedSteps++;s.generation++;if(!Number.isSafeInteger(s.generation))throw Error('Household generation exhausted.');
    }
    const accepted=ownHouseholdSimulation(s);return accepted.ok?{...accepted,processedSteps,deferredSteps:Math.floor(s.events.world.pendingMilliseconds/s.events.world.stepMilliseconds)}:accepted;
  }catch(cause){return fail(cause instanceof Error?cause.message:'Household catch-up failed atomically.');}
}
/** Reports are permitted only across an actual shared abstract endpoint. This
 * is NOT proof of contact/visibility in the real Elderbloom geometry. No trust
 * score is changed; repeated knowledge cannot farm reputation here. */
export function applyHouseholdCommand(snapshot:HouseholdSimulation,input:{readonly expectedGeneration:number;readonly command:HouseholdCommand}):HouseholdSimulationResult {
  const checked=ownHouseholdSimulation(snapshot);if(!checked.ok)return checked;
  try{
    placeDataRecord(input,['expectedGeneration','command']);num(input.expectedGeneration);const c=command(input.command),previous=snapshot.commands.find(r=>r.command.id===c.id);
    if(input.expectedGeneration!==snapshot.generation)return fail('Stale household writer generation.');
    if(previous)return same(previous.command,c)?{ok:true,snapshot:checked.snapshot}:fail('A household command ID cannot be rewritten.');
    if(snapshot.events.world.pendingMilliseconds>=snapshot.events.world.stepMilliseconds)throw Error('Finish bounded away catch-up before applying a new live command.');
    const s=working(checked.snapshot),minute=s.events.world.elapsedSteps;let contact:HouseholdCommandRecord['contact']=null;
    if(c.kind==='report'){
      const source=s.events.knowledge.find(k=>k.id===c.sourceKnowledgeId),sender=s.actors.find(a=>a.residentId===source?.residentId),recipient=s.actors.find(a=>a.residentId===c.recipientId);
      if(!source||!sender||!recipient||sender.residentId===recipient.residentId||sender.placeId!==c.contactPlaceId||recipient.placeId!==c.contactPlaceId)throw Error('A report requires known evidence and actual endpoint contact.');
      contact={senderId:sender.residentId,recipientId:recipient.residentId,placeId:c.contactPlaceId};
      const collision=s.events.knowledge.find(k=>k.id===c.knowledgeId);
      if(collision&&(collision.eventId!==source.eventId||collision.residentId!==c.recipientId||collision.mode!==c.mode||collision.sourceKnowledgeId!==c.sourceKnowledgeId))throw Error('A knowledge ID cannot be rewritten.');
      if(source.mode==='rumor'&&c.mode==='report')throw Error('Rumor cannot be promoted into reliable evidence.');
      const alreadyKnown=s.events.knowledge.some(k=>k.eventId===source.eventId&&k.residentId===c.recipientId&&(k.mode==='witness'||k.mode==='report'||k.mode===c.mode));
      if(!alreadyKnown){const result=transmitPeopleLifeKnowledge(s.events,{id:c.knowledgeId,recipientId:c.recipientId,sourceKnowledgeId:c.sourceKnowledgeId,mode:c.mode,atStep:minute});if(!result.ok)throw Error(result.error);s.events=result.snapshot;}
    }else{
      const a=s.actions.find(a=>a.id===c.taskId),task=s.definition.tasks.find(t=>t.id===c.taskId);if(!a||!task)throw Error('Unknown household task.');
      if(c.kind==='interrupt')interrupt(s,a);else{if(a.status!=='interrupted')throw Error('Only an interrupted action can resume.');const route=s.definition.routes.find(r=>r.id===task.routeId)!;if(a.routeProgress<route.travelMinutes)a.status='travelling';else request(s,a,task);}
      promote(s);
    }
    s.commands.push({command:c,atMinute:minute,contact});s.generation++;if(!Number.isSafeInteger(s.generation))throw Error('Household generation exhausted.');return ownHouseholdSimulation(s);
  }catch(cause){return fail(cause instanceof Error?cause.message:'Household command failed atomically.');}
}
export function serializeHouseholdSimulation(snapshot:HouseholdSimulation):{readonly ok:true;readonly json:string}|{readonly ok:false;readonly error:string} {
  const result=ownHouseholdSimulation(snapshot);return result.ok?{ok:true,json:JSON.stringify(result.snapshot)}:result;
}
export function parseHouseholdSimulation(json:string,expectedRevision?:string):HouseholdSimulationResult {
  try{if(typeof json!=='string')throw Error('Supply serialized household data.');const result=ownHouseholdSimulation(JSON.parse(json));
    return result.ok&&expectedRevision!==undefined&&result.snapshot.definition.revision!==expectedRevision?fail('Household content revision requires explicit migration.'):result;
  }catch{return fail('Invalid household JSON.');}
}
