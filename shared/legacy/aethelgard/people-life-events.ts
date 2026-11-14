// Original ES2020 experiment kernel. Structured state only: no dialogue, names,
// random history, storage, Date/clock reads, standing, or action completion.
// Pattern references (not copied code): MIT Neighborly life-event histories and
// MIT TDRS bound preconditions/effects. The inherited save schema is untouched.
import { validatePeopleLifeRegistry, getPeopleLifeRoutine, type PeopleLifeRegistry } from './people-life';
export interface PeopleLifeFactDefinition {readonly id:string;readonly subjectIds:readonly string[];readonly initialValue:boolean;readonly initiallyKnownTo:readonly string[]}
export interface PeopleLifeEventType {readonly id:string;readonly factIds:readonly string[];readonly allowsFamilyRevision:boolean}
export interface PeopleLifeFactEffect {readonly factId:string;readonly value:boolean}
export type PeopleLifeFamilyPurpose='shared-meal'|'care'|'protection'|'visit'|'obligation';
export interface PeopleLifeFamilyRule {
  readonly id:string;readonly residentId:string;readonly relativeId:string;readonly relation:'kin'|'household'|'social';
  readonly purpose:PeopleLifeFamilyPurpose;readonly placeId:string;readonly startMinute:number;readonly endMinute:number;
  readonly conditions:readonly {readonly factId:string;readonly value:boolean;readonly certainty:'witness-or-report'|'including-rumor'}[];
}
export interface PeopleLifeEventModel {readonly facts:readonly PeopleLifeFactDefinition[];readonly eventTypes:readonly PeopleLifeEventType[];readonly familyRules:readonly PeopleLifeFamilyRule[]}
export interface PeopleLifeWorldClock {
  readonly startedAt:number;readonly lastSimulatedAt:number;readonly lastObservedAt:number;
  readonly stepMilliseconds:number;readonly elapsedSteps:number;readonly pendingMilliseconds:number;readonly seed:number;
}
export interface PeopleLifePresence {readonly residentId:string;readonly placeId:string}
export interface PeopleLifeOccurrenceCommand {
  readonly id:string;readonly typeId:string;readonly atStep:number;readonly actorIds:readonly string[];readonly placeId:string;
  readonly effects:readonly PeopleLifeFactEffect[];readonly presence:readonly PeopleLifePresence[];
  /** Explicit observed presence only; authored routines never prove witnessing. */
  readonly witnesses:readonly {readonly knowledgeId:string;readonly residentId:string}[];
}
export interface PeopleLifeOccurrence extends PeopleLifeOccurrenceCommand {readonly registryRevision:PeopleLifeRegistry|null}
export interface PeopleLifeKnowledge {
  readonly id:string;readonly eventId:string;readonly residentId:string;readonly mode:'witness'|'report'|'rumor';
  readonly sourceKnowledgeId:string|null;readonly atStep:number;
}
export interface PeopleLifeFamilyDecision {
  readonly id:string;readonly atStep:number;readonly residentId:string;readonly ruleId:string;
  readonly eventCount:number;readonly knowledgeCount:number;
}
export interface PeopleLifeEventsSnapshot {
  readonly kind:'people-life-experiment';readonly schemaVersion:1;readonly registry:PeopleLifeRegistry;readonly model:PeopleLifeEventModel;
  readonly world:PeopleLifeWorldClock;readonly facts:readonly {readonly id:string;readonly value:boolean;readonly eventId:string|null}[];
  readonly events:readonly PeopleLifeOccurrence[];readonly knowledge:readonly PeopleLifeKnowledge[];readonly decisions:readonly PeopleLifeFamilyDecision[];
}
export type PeopleLifeEventsResult={readonly ok:true;readonly snapshot:PeopleLifeEventsSnapshot}|{readonly ok:false;readonly error:string};
export interface PeopleLifeBelief {readonly value:boolean;readonly basis:'initial'|'witness'|'report'|'rumor';readonly eventId:string|null;readonly knowledgeId:string|null}
export interface PeopleLifeFamilyIntent {readonly residentId:string;readonly ruleId:string;readonly relativeId:string;readonly purpose:PeopleLifeFamilyPurpose;readonly placeId:string;readonly knowledgeIds:readonly string[]}
export const PEOPLE_LIFE_MAX_CATCHUP_STEPS=1440;
type Data=Record<string,unknown>;
function shape(v:unknown,keys:readonly string[]):v is Data {
  return v!==null&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).length===keys.length
    &&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable===true&&'value'in d;});
}
function array(v:unknown):v is unknown[]{
  if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||Reflect.ownKeys(v).length!==v.length+1)return false;
  for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d?.enumerable||!('value'in d))return false;}return true;
}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&typeof v==='number'&&v>=0;
const ids=(v:unknown):v is string[]=>array(v)&&v.every(id)&&new Set(v).size===v.length;
function own<T>(v:T):T {
  if(Array.isArray(v))return Object.freeze(v.map(own))as T;
  if(v!==null&&typeof v==='object')return Object.freeze(Object.fromEntries(Object.keys(v).map(k=>[k,own(Object.getOwnPropertyDescriptor(v,k)!.value)])))as T;return v;
}
const fail=(error:string):{readonly ok:false;readonly error:string}=>({ok:false,error});
function same(a:unknown,b:unknown):boolean {
  if(a===b)return true;if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));
  const left=Object.keys(a).sort(),right=Object.keys(b).sort();return left.length===right.length&&left.every((key,i)=>key===right[i]&&same(Object.getOwnPropertyDescriptor(a,key)?.value,Object.getOwnPropertyDescriptor(b,key)?.value));
}
function worldError(v:unknown):string|null {
  if(!shape(v,['startedAt','lastSimulatedAt','lastObservedAt','stepMilliseconds','elapsedSteps','pendingMilliseconds','seed'])||!Object.values(v).every(integer)
    ||v.stepMilliseconds===0||(v.seed as number)>0xffffffff)return 'Invalid persistent world clock.';
  const w=v as unknown as PeopleLifeWorldClock,expected=w.startedAt+w.elapsedSteps*w.stepMilliseconds;
  return !Number.isSafeInteger(expected)||w.lastSimulatedAt!==expected||w.lastObservedAt<w.lastSimulatedAt||w.pendingMilliseconds!==w.lastObservedAt-w.lastSimulatedAt?'World clock cursor/horizon disagree.':null;
}
export function getPeopleLifeEventsRegistry(s:PeopleLifeEventsSnapshot):PeopleLifeRegistry {
  for(let i=s.events.length-1;i>=0;i--)if(s.events[i].registryRevision)return s.events[i].registryRevision!;return s.registry;
}
function modelError(value:unknown,registry:PeopleLifeRegistry):string|null {
  if(!shape(value,['facts','eventTypes','familyRules'])||!array(value.facts)||!array(value.eventTypes)||!array(value.familyRules))return 'Invalid structured event model.';
  const people=new Set(registry.residents.map(r=>r.id)),places=new Set(registry.places.map(p=>p.id)),facts=new Set<string>(),types=new Set<string>(),rules=new Set<string>();
  for(const f of value.facts){if(!shape(f,['id','subjectIds','initialValue','initiallyKnownTo'])||!id(f.id)||facts.has(f.id)||!ids(f.subjectIds)||!f.subjectIds.length||!f.subjectIds.every(p=>people.has(p))||typeof f.initialValue!=='boolean'||!ids(f.initiallyKnownTo)||!f.initiallyKnownTo.every(p=>people.has(p)))return 'Facts require distinct registered subjects and explicit initial knowledge.';facts.add(f.id);}
  for(const t of value.eventTypes){if(!shape(t,['id','factIds','allowsFamilyRevision'])||!id(t.id)||types.has(t.id)||!ids(t.factIds)||!t.factIds.every(f=>facts.has(f))||typeof t.allowsFamilyRevision!=='boolean')return 'Event types require distinct IDs and registered fact effects.';types.add(t.id);}
  for(const r of value.familyRules){
    if(!shape(r,['id','residentId','relativeId','relation','purpose','placeId','startMinute','endMinute','conditions'])||!id(r.id)||rules.has(r.id)||!people.has(r.residentId as string)||!people.has(r.relativeId as string)||r.residentId===r.relativeId||!['kin','household','social'].includes(r.relation as string)||!['shared-meal','care','protection','visit','obligation'].includes(r.purpose as string)||!places.has(r.placeId as string)||!integer(r.startMinute)||!integer(r.endMinute)||r.startMinute>=r.endMinute||r.endMinute>1440||!array(r.conditions))return 'Family rules require explicit residents, relationship, purpose, place and interval.';
    if(r.conditions.some(c=>!shape(c,['factId','value','certainty'])||!facts.has(c.factId as string)||typeof c.value!=='boolean'||!['witness-or-report','including-rumor'].includes(c.certainty as string)))return 'Family conditions must use registered facts and explicit knowledge certainty.';rules.add(r.id);
  }
  return null;
}
function revisionError(before:PeopleLifeRegistry,after:unknown):string|null {
  const error=validatePeopleLifeRegistry(after);if(error)return error;const next=after as PeopleLifeRegistry;
  if(!same(before.places,next.places)||before.residents.length!==next.residents.length)return 'Family revisions preserve places and resident identities.';
  for(const a of before.residents){const b=next.residents.find(r=>r.id===a.id);
    if(!b||!same([a.id,a.label,a.identityNote,a.role,a.influenceSensitivity,a.decisionMemory],[b.id,b.label,b.identityNote,b.role,b.influenceSensitivity,b.decisionMemory]))return 'Family revisions cannot rewrite resident identity, role or sensitivity.';}
  return null;
}
function eventError(v:unknown,registry:PeopleLifeRegistry,model:PeopleLifeEventModel,step:number):string|null {
  if(!shape(v,['id','typeId','atStep','actorIds','placeId','effects','presence','witnesses','registryRevision'])||!id(v.id)||!id(v.typeId)||!integer(v.atStep)||v.atStep>step||!ids(v.actorIds)||!v.actorIds.length||!id(v.placeId)||!array(v.effects)||!array(v.presence)||!array(v.witnesses))return 'Invalid occurred event record.';
  const people=new Set(registry.residents.map(r=>r.id)),places=new Set(registry.places.map(p=>p.id)),type=model.eventTypes.find(t=>t.id===v.typeId);
  if(!type||!places.has(v.placeId)||!v.actorIds.every(p=>people.has(p)))return 'Occurred events need registered types, actors and places.';
  const affected=new Set<string>();for(const e of v.effects){if(!shape(e,['factId','value'])||!id(e.factId)||!type.factIds.includes(e.factId)||typeof e.value!=='boolean'||affected.has(e.factId))return 'An event can set each permitted boolean fact once.';affected.add(e.factId);}
  const present=new Map<string,string>();for(const p of v.presence){if(!shape(p,['residentId','placeId'])||!people.has(p.residentId as string)||!places.has(p.placeId as string)||present.has(p.residentId as string))return 'Presence evidence must explicitly identify distinct registered residents and places.';present.set(p.residentId as string,p.placeId as string);}
  if(v.actorIds.some(p=>present.get(p)!==v.placeId))return 'Event actors require explicit presence at its place.';
  const witnesses=new Set<string>(),witnessIds=new Set<string>();for(const w of v.witnesses){if(!shape(w,['knowledgeId','residentId'])||!id(w.knowledgeId)||!id(w.residentId)||present.get(w.residentId)!==v.placeId||witnesses.has(w.residentId)||witnessIds.has(w.knowledgeId))return 'Witness knowledge requires explicit same-place presence, never a routine inference.';witnesses.add(w.residentId);witnessIds.add(w.knowledgeId);}
  if(v.registryRevision!==null){
    if(!type.allowsFamilyRevision)return 'This event type cannot revise household/family state.';
    const error=revisionError(registry,v.registryRevision);if(error)return error;
    const next=v.registryRevision as PeopleLifeRegistry,changed=registry.residents.filter(r=>!same(r,next.residents.find(n=>n.id===r.id)));
    if(!changed.length||changed.some(r=>!(v.actorIds as string[]).includes(r.id)))return 'A family revision must explicitly include every changed resident as an actor.';
  }
  return null;
}
/** Global truth and a resident's knowledge are intentionally separate. A newer
 * unknown event cannot silently rewrite that resident's existing belief. */
export function getPeopleLifeBelief(s:PeopleLifeEventsSnapshot,residentId:string,factId:string,includeRumor=false):PeopleLifeBelief|null {
  if(!getPeopleLifeEventsRegistry(s).residents.some(r=>r.id===residentId))return null;
  for(let i=s.events.length-1;i>=0;i--){const e=s.events[i],effect=e.effects.find(f=>f.factId===factId);if(!effect)continue;
    for(const mode of ['witness','report',...(includeRumor?['rumor']:[])]as const){const k=s.knowledge.find(k=>k.residentId===residentId&&k.eventId===e.id&&k.mode===mode);if(k)return own({value:effect.value,basis:k.mode,eventId:e.id,knowledgeId:k.id});}
  }
  const f=s.model.facts.find(f=>f.id===factId);return f?.initiallyKnownTo.includes(residentId)?own({value:f.initialValue,basis:'initial',eventId:null,knowledgeId:null}):null;
}
/** Apply only a known revision's changed fields. Seeing one later household
 * event cannot reveal unrelated earlier changes hidden in its full snapshot. */
export function getPeopleLifePerceivedRegistry(s:PeopleLifeEventsSnapshot,residentId:string):PeopleLifeRegistry {
  let actual=s.registry,perceived=s.registry;
  for(const event of s.events){const next=event.registryRevision;if(!next)continue;
    if(s.knowledge.some(k=>k.residentId===residentId&&k.eventId===event.id&&k.mode!=='rumor')){
      const residents=perceived.residents.map(r=>{
        const before=actual.residents.find(p=>p.id===r.id)!,after=next.residents.find(p=>p.id===r.id)!,patch:Record<string,unknown>={};
        for(const field of ['homeHouseholdId','family','socialTies','routine']as const)if(!same(before[field],after[field]))patch[field]=after[field];
        return{...r,...patch};
      });
      const homeIds=[...new Set(residents.map(r=>r.homeHouseholdId))],households=homeIds.map(id=>{
        const prior=perceived.households.find(h=>h.id===id),before=actual.households.find(h=>h.id===id),after=next.households.find(h=>h.id===id);
        const changed=after&&(!before||before.label!==after.label||before.homePlaceId!==after.homePlaceId),home=(changed?after:prior)??after!;
        return{...home,memberIds:residents.filter(r=>r.homeHouseholdId===id).map(r=>r.id)};
      });perceived=own({places:s.registry.places,households,residents});
    }actual=next;
  }return perceived;
}
export function selectPeopleLifeFamilyIntent(s:PeopleLifeEventsSnapshot,residentId:string):PeopleLifeFamilyIntent|null {
  const registry=getPeopleLifePerceivedRegistry(s,residentId),resident=registry.residents.find(r=>r.id===residentId),minute=s.world.elapsedSteps%1440;if(!resident)return null;
  for(const rule of s.model.familyRules){
    if(rule.residentId!==residentId||minute<rule.startMinute||minute>=rule.endMinute)continue;
    const other=registry.residents.find(r=>r.id===rule.relativeId);if(!other)continue;
    const related=rule.relation==='kin'?resident.family.kind==='local-kin'&&resident.family.ties.some(t=>t.residentId===other.id):rule.relation==='household'?resident.homeHouseholdId===other.homeHouseholdId:resident.socialTies.some(t=>t.residentId===other.id);
    if(!related)continue;const beliefs=rule.conditions.map(c=>getPeopleLifeBelief(s,residentId,c.factId,c.certainty==='including-rumor'));
    if(rule.conditions.some((c,i)=>!beliefs[i]||beliefs[i]!.value!==c.value))continue;
    return own({residentId,ruleId:rule.id,relativeId:rule.relativeId,purpose:rule.purpose,placeId:rule.placeId,knowledgeIds:beliefs.flatMap(b=>b?.knowledgeId?[b.knowledgeId]:[])});
  }return null;
}
export function getPeopleLifeWorldPlan(s:PeopleLifeEventsSnapshot,residentId:string){
  return selectPeopleLifeFamilyIntent(s,residentId)??getPeopleLifeRoutine(getPeopleLifePerceivedRegistry(s,residentId),residentId,s.world.elapsedSteps%1440);
}
/** Strict separate-snapshot validation: replay truth, verify epistemic chains,
 * reject unknown fields and preserve the existing inherited-save boundary. */
export function validatePeopleLifeEventsSnapshot(value:unknown):string|null {
  if(!shape(value,['kind','schemaVersion','registry','model','world','facts','events','knowledge','decisions'])||value.kind!=='people-life-experiment')return 'This is not a people-life experiment snapshot.';
  if(value.schemaVersion!==1)return typeof value.schemaVersion==='number'&&value.schemaVersion>1?'Future people-life snapshot version.':'Unsupported people-life snapshot version.';
  const registryProblem=validatePeopleLifeRegistry(value.registry);if(registryProblem)return registryProblem;
  const registry=value.registry as PeopleLifeRegistry,modelProblem=modelError(value.model,registry),clockProblem=worldError(value.world);if(modelProblem||clockProblem)return modelProblem??clockProblem;
  if(!array(value.facts)||!array(value.events)||!array(value.knowledge)||!array(value.decisions))return 'Snapshot ledgers must be dense plain arrays.';
  const s=value as unknown as PeopleLifeEventsSnapshot,model=s.model,events=new Map<string,PeopleLifeOccurrence>(),known=new Map<string,PeopleLifeKnowledge>();
  let currentRegistry=registry,lastEventStep=0,lastKnowledgeStep=0;
  const facts=model.facts.map(f=>({id:f.id,value:f.initialValue,eventId:null as string|null}));
  for(const event of s.events){
    const error=eventError(event,currentRegistry,model,s.world.elapsedSteps);if(error)return error;
    if(events.has(event.id)||event.atStep<lastEventStep)return 'Occurred event IDs must be unique and chronologically ordered.';events.set(event.id,event);lastEventStep=event.atStep;
    for(const effect of event.effects){const fact=facts.find(f=>f.id===effect.factId)!;fact.value=effect.value;fact.eventId=event.id;}
    if(event.registryRevision)currentRegistry=event.registryRevision;
  }
  if(value.facts.some(f=>!shape(f,['id','value','eventId'])||!id(f.id)||typeof f.value!=='boolean'||f.eventId!==null&&!id(f.eventId))||!same(value.facts,facts))return 'Structured facts must exactly replay the occurred-event effects.';
  for(const k of s.knowledge){
    if(!shape(k,['id','eventId','residentId','mode','sourceKnowledgeId','atStep'])||!id(k.id)||known.has(k.id)||!id(k.eventId)||!id(k.residentId)||!currentRegistry.residents.some(r=>r.id===k.residentId)||!['witness','report','rumor'].includes(k.mode)||!integer(k.atStep)||k.atStep<lastKnowledgeStep||k.atStep>s.world.elapsedSteps)return 'Invalid individual knowledge record.';
    const event=events.get(k.eventId);if(!event||k.atStep<event.atStep)return 'Knowledge cannot precede a real occurred event.';
    if(k.mode==='witness'){
      if(k.sourceKnowledgeId!==null||k.atStep!==event.atStep||!event.witnesses.some(w=>w.knowledgeId===k.id&&w.residentId===k.residentId))return 'Witnessing needs the event explicit presence evidence.';
    }else{
      if(!id(k.sourceKnowledgeId))return 'Reports and rumors require a recorded source.';const source=known.get(k.sourceKnowledgeId);
      if(!source||source.eventId!==k.eventId||source.residentId===k.residentId||source.atStep>k.atStep||source.mode==='rumor'&&k.mode==='report')return 'Knowledge provenance cannot be invented or upgrade rumor into certainty.';
    }
    known.set(k.id,k);lastKnowledgeStep=k.atStep;
  }
  for(const event of s.events)for(const witness of event.witnesses){const k=known.get(witness.knowledgeId);if(!k||k.mode!=='witness'||k.eventId!==event.id||k.residentId!==witness.residentId)return 'Every declared witness must have its exact recorded knowledge entry.';}
  const decisions=new Set<string>();let lastDecisionStep=0;
  for(const d of s.decisions){
    if(!shape(d,['id','atStep','residentId','ruleId','eventCount','knowledgeCount'])||!id(d.id)||decisions.has(d.id)||!id(d.residentId)||!id(d.ruleId)||!integer(d.atStep)||d.atStep<lastDecisionStep||d.atStep>s.world.elapsedSteps||!integer(d.eventCount)||d.eventCount>s.events.length||!integer(d.knowledgeCount)||d.knowledgeCount>s.knowledge.length)return 'Invalid family-intent decision record.';
    const prefix={...s,events:s.events.slice(0,d.eventCount),knowledge:s.knowledge.slice(0,d.knowledgeCount),world:{...s.world,elapsedSteps:d.atStep}};
    if(prefix.events.some(e=>e.atStep>d.atStep)||prefix.knowledge.some(k=>k.atStep>d.atStep||!prefix.events.some(e=>e.id===k.eventId))||selectPeopleLifeFamilyIntent(prefix,d.residentId)?.ruleId!==d.ruleId)return 'A family decision must replay its actual knowledge and relationship context.';
    decisions.add(d.id);lastDecisionStep=d.atStep;
  }
  return null;
}
export function ownPeopleLifeEventsSnapshot(value:unknown):PeopleLifeEventsResult {
  const error=validatePeopleLifeEventsSnapshot(value);return error?fail(error):{ok:true,snapshot:own(value as PeopleLifeEventsSnapshot)};
}
export function createPeopleLifeEventsSnapshot(registry:PeopleLifeRegistry,model:PeopleLifeEventModel,clock:{readonly startedAt:number;readonly stepMilliseconds:number;readonly seed:number}):PeopleLifeEventsResult {
  const registryError=validatePeopleLifeRegistry(registry);if(registryError)return fail(registryError);const problem=modelError(model,registry);if(problem)return fail(problem);
  if(!shape(clock,['startedAt','stepMilliseconds','seed']))return fail('Supply explicit plain world-clock settings.');
  return ownPeopleLifeEventsSnapshot({kind:'people-life-experiment',schemaVersion:1,registry,model,
    world:{startedAt:clock.startedAt,lastSimulatedAt:clock.startedAt,lastObservedAt:clock.startedAt,stepMilliseconds:clock.stepMilliseconds,elapsedSteps:0,pendingMilliseconds:0,seed:clock.seed},
    facts:model.facts.map(f=>({id:f.id,value:f.initialValue,eventId:null})),events:[],knowledge:[],decisions:[]});
}
function record(s:PeopleLifeEventsSnapshot,command:PeopleLifeOccurrenceCommand,revision:PeopleLifeRegistry|null):PeopleLifeEventsResult {
  const problem=validatePeopleLifeEventsSnapshot(s);if(problem)return fail(problem);
  if(!shape(command,['id','typeId','atStep','actorIds','placeId','effects','presence','witnesses']))return fail('Supply explicit occurred-event data only.');
  const event={...command,registryRevision:revision},previousIndex=s.events.findIndex(e=>e.id===event.id);
  const before=previousIndex<0?s:{...s,events:s.events.slice(0,previousIndex)};
  const error=eventError(event,getPeopleLifeEventsRegistry(before),s.model,s.world.elapsedSteps);if(error)return fail(error);
  if(previousIndex>=0)return same(s.events[previousIndex],event)?{ok:true,snapshot:s}:fail('An occurred event cannot be rewritten.');
  if(command.atStep!==s.world.elapsedSteps)return fail('Record occurrence at the current simulated minute.');
  const facts=s.facts.map(f=>{const effect=event.effects.find(e=>e.factId===f.id);return effect?{id:f.id,value:effect.value,eventId:event.id}:f;});
  const witnessKnowledge=event.witnesses.map(w=>({id:w.knowledgeId,eventId:event.id,residentId:w.residentId,mode:'witness'as const,sourceKnowledgeId:null,atStep:event.atStep}));
  return ownPeopleLifeEventsSnapshot({...s,facts,events:[...s.events,event],knowledge:[...s.knowledge,...witnessKnowledge]});
}
export function recordPeopleLifeOccurrence(s:PeopleLifeEventsSnapshot,command:PeopleLifeOccurrenceCommand):PeopleLifeEventsResult {return record(s,command,null);}
/** Explicit authored household/relationship change, never generated marriage,
 * loss or task completion. It uses the same occurrence/presence knowledge gate. */
export function recordPeopleLifeFamilyRevision(s:PeopleLifeEventsSnapshot,command:PeopleLifeOccurrenceCommand,registry:PeopleLifeRegistry):PeopleLifeEventsResult {return record(s,command,registry);}
/** Authoritative host-input boundary: the host must prove an actual encounter
 * or approved communication channel. Provenance alone is not communication,
 * and projected routine co-location grants no knowledge automatically. */
export function transmitPeopleLifeKnowledge(s:PeopleLifeEventsSnapshot,command:{readonly id:string;readonly recipientId:string;readonly sourceKnowledgeId:string;readonly mode:'report'|'rumor';readonly atStep:number}):PeopleLifeEventsResult {
  const problem=validatePeopleLifeEventsSnapshot(s);if(problem)return fail(problem);
  if(!shape(command,['id','recipientId','sourceKnowledgeId','mode','atStep'])||!id(command.id)||!id(command.recipientId)||!id(command.sourceKnowledgeId)||command.atStep!==s.world.elapsedSteps||!['report','rumor'].includes(command.mode))return fail('Supply a report or rumor at the current simulated minute.');
  const source=s.knowledge.find(k=>k.id===command.sourceKnowledgeId);if(!source)return fail('The source must actually know the event.');
  const knowledge={id:command.id,eventId:source.eventId,residentId:command.recipientId,mode:command.mode,sourceKnowledgeId:source.id,atStep:command.atStep};
  const previous=s.knowledge.find(k=>k.id===command.id);if(previous)return same(previous,knowledge)?{ok:true,snapshot:s}:fail('A knowledge record cannot be rewritten.');
  return ownPeopleLifeEventsSnapshot({...s,knowledge:[...s.knowledge,knowledge]});
}
export function recordPeopleLifeFamilyDecision(s:PeopleLifeEventsSnapshot,command:{readonly id:string;readonly residentId:string;readonly atStep:number}):PeopleLifeEventsResult {
  const problem=validatePeopleLifeEventsSnapshot(s);if(problem)return fail(problem);
  if(!shape(command,['id','residentId','atStep'])||!id(command.id)||!id(command.residentId)||!integer(command.atStep))return fail('Invalid family-intent decision.');
  const previous=s.decisions.find(d=>d.id===command.id);
  if(previous)return previous.residentId===command.residentId&&previous.atStep===command.atStep?{ok:true,snapshot:s}:fail('A family decision cannot be rewritten.');
  if(command.atStep!==s.world.elapsedSteps)return fail('Choose at the current simulated minute.');
  const intent=selectPeopleLifeFamilyIntent(s,command.residentId);if(!intent)return fail('No family intent meets the current relationship/knowledge conditions.');
  return ownPeopleLifeEventsSnapshot({...s,decisions:[...s.decisions,{id:command.id,atStep:command.atStep,residentId:command.residentId,ruleId:intent.ruleId,eventCount:s.events.length,knowledgeCount:s.knowledge.length}]});
}
export interface PeopleLifeCatchupStatus {readonly deferredMilliseconds:number;readonly deferredSteps:number;readonly fractionalMilliseconds:number}
export function getPeopleLifeCatchupStatus(s:PeopleLifeEventsSnapshot):PeopleLifeCatchupStatus {
  const pending=s.world.pendingMilliseconds,step=s.world.stepMilliseconds;
  return own({deferredMilliseconds:pending,deferredSteps:Math.floor(pending/step),fractionalMilliseconds:pending%step});
}
export type PeopleLifeCatchupResult=({readonly ok:true;readonly snapshot:PeopleLifeEventsSnapshot;readonly processedSteps:number}&PeopleLifeCatchupStatus)|{readonly ok:false;readonly error:string};
/** Persistent world time, independent of visibility or active-visit animation.
 * Fixed minute steps are deterministic across capped batches/reloads. This
 * advances routine/intention projections, never asserts actions or witnesses.
 * A future action executor must explicitly record observed occurred events. */
export function catchUpPeopleLifeEvents(s:PeopleLifeEventsSnapshot,observedAt:number,maxSteps:number):PeopleLifeCatchupResult {
  const problem=validatePeopleLifeEventsSnapshot(s);if(problem)return fail(problem);
  if(!integer(observedAt)||observedAt<s.world.lastObservedAt||!integer(maxSteps)||maxSteps<1||maxSteps>PEOPLE_LIFE_MAX_CATCHUP_STEPS)return fail('Supply monotonic caller time and a bounded catch-up budget.');
  const pending=observedAt-s.world.lastSimulatedAt,processedSteps=Math.min(Math.floor(pending/s.world.stepMilliseconds),maxSteps),elapsedSteps=s.world.elapsedSteps+processedSteps;
  const lastSimulatedAt=s.world.startedAt+elapsedSteps*s.world.stepMilliseconds;
  const result=ownPeopleLifeEventsSnapshot({...s,world:{...s.world,lastObservedAt:observedAt,lastSimulatedAt,elapsedSteps,pendingMilliseconds:observedAt-lastSimulatedAt}});
  return result.ok===true?{ok:true,snapshot:result.snapshot,processedSteps,...getPeopleLifeCatchupStatus(result.snapshot)}:result;
}
