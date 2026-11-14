// Count-independent preparation only. This module supplies no residents, names,
// relatives or history, changes no save schema, and creates no story effects.
// Every resident uses the same capabilities; sensitivity is a data trait, never
// a class, rank, player-resident flag or source-identification capability.
import { EALDHOLT_PEOPLE_DRAFT } from './people-draft';
import type { InheritedSession } from './inherited-session';
export const PEOPLE_LIFE_MODEL_STATUS='working-schema'as const;
export type PeopleLifeInfluenceSensitivity='occasional'|'persistent';
/** Universal invariant, not an editable resident capability or awareness flag. */
export const PEOPLE_LIFE_INFLUENCE_SOURCE='unknown'as const;
/** Existing saved-content IDs only: no priority, class, rank or resident limit. */
export const PEOPLE_LIFE_COMPATIBILITY_PERSON_IDS:readonly string[]=Object.freeze(EALDHOLT_PEOPLE_DRAFT.map(p=>p.id));
export interface PeopleLifePlace {readonly id:string;readonly label:string}
export interface PeopleLifeHousehold {readonly id:string;readonly label:string;readonly homePlaceId:string;readonly memberIds:readonly string[]}
export type PeopleLifeKinKind='parent'|'child'|'sibling'|'partner'|'other';
/** kind names the other person's relationship to the resident: a 'parent'
 * target must explicitly list this resident as a 'child'. */
export interface PeopleLifeKin {readonly residentId:string;readonly kind:PeopleLifeKinKind;readonly description:string}
export type PeopleLifeFamily={readonly kind:'local-kin';readonly ties:readonly PeopleLifeKin[]}
  |{readonly kind:'no-local-kin';readonly explanation:string};
export interface PeopleLifeSocialTie {readonly residentId:string;readonly description:string}
export interface PeopleLifeRoutine {
  /** Authored full-day intervals: inclusive start, exclusive end, 0..1440. */
  readonly startMinute:number;readonly endMinute:number;readonly activity:string;readonly placeId:string;readonly companionIds:readonly string[];
}
export interface PeopleLifeResident {
  readonly id:string;readonly label:string;readonly identityNote:string;
  readonly influenceSensitivity:PeopleLifeInfluenceSensitivity;
  readonly role:{readonly id:string;readonly label:string;readonly purpose:string};
  readonly homeHouseholdId:string;readonly family:PeopleLifeFamily;readonly socialTies:readonly PeopleLifeSocialTie[];
  readonly routine:readonly PeopleLifeRoutine[];
  /** Empty actual choice history is legitimate. Facts never imply a memory. */
  readonly decisionMemory:{readonly source:'inherited-story-choices'};
}
export interface PeopleLifeRegistry {readonly places:readonly PeopleLifePlace[];readonly households:readonly PeopleLifeHousehold[];readonly residents:readonly PeopleLifeResident[]}
export type PeopleLifeRegistryResult={readonly ok:true;readonly registry:PeopleLifeRegistry}|{readonly ok:false;readonly error:string};
type Data=Record<string,unknown>;
function shape(value:unknown,keys:readonly string[]):value is Data {
  if(value===null||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  return Reflect.ownKeys(value).length===keys.length&&keys.every(key=>{const d=Object.getOwnPropertyDescriptor(value,key);return d?.enumerable===true&&'value'in d;});
}
function array(value:unknown):value is unknown[]{
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||Reflect.ownKeys(value).length!==value.length+1)return false;
  for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d?.enumerable||!('value'in d))return false;}return true;
}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=400;
const distinctIds=(v:unknown):v is string[]=>array(v)&&v.every(id)&&new Set(v).size===v.length;
function freezeCopy<T>(value:T):T {
  if(Array.isArray(value))return Object.freeze(value.map(v=>freezeCopy(v)))as T;
  if(value!==null&&typeof value==='object')return Object.freeze(Object.fromEntries(Object.keys(value).map(k=>[k,freezeCopy(Object.getOwnPropertyDescriptor(value,k)!.value)])))as T;
  return value;
}
/** Validates only authored content. No identities, reciprocal ties or missing
 * routine slots are invented to repair incomplete input. */
export function validatePeopleLifeRegistry(value:unknown):string|null {
  if(!shape(value,['places','households','residents'])||!array(value.places)||!array(value.households)||!array(value.residents))return 'Supply places, households and residents as plain data.';
  const places=new Set<string>(),households=new Map<string,PeopleLifeHousehold>(),residents=new Map<string,PeopleLifeResident>();
  for(const p of value.places){if(!shape(p,['id','label'])||!id(p.id)||!text(p.label)||places.has(p.id))return 'Each place needs a distinct ID and label.';places.add(p.id);}
  for(const h of value.households){if(!shape(h,['id','label','homePlaceId','memberIds'])||!id(h.id)||!text(h.label)||!id(h.homePlaceId)||!places.has(h.homePlaceId)||!distinctIds(h.memberIds)||!h.memberIds.length||households.has(h.id))return 'Each household needs a distinct ID, registered home and explicit members.';households.set(h.id,h as unknown as PeopleLifeHousehold);}
  for(const r of value.residents){
    if(!shape(r,['id','label','identityNote','influenceSensitivity','role','homeHouseholdId','family','socialTies','routine','decisionMemory'])||!id(r.id)||!text(r.label)||!text(r.identityNote)||residents.has(r.id))return 'Each resident needs a distinct stable identity and authored identity note.';
    if(r.influenceSensitivity!=='occasional'&&r.influenceSensitivity!=='persistent')return 'Each resident needs explicit occasional or persistent influence sensitivity.';
    if(!shape(r.role,['id','label','purpose'])||!id(r.role.id)||!text(r.role.label)||!text(r.role.purpose))return 'Every resident needs an authored role and purpose.';
    if(!id(r.homeHouseholdId)||!households.has(r.homeHouseholdId))return 'Every resident needs a registered home household.';
    if(!shape(r.decisionMemory,['source'])||r.decisionMemory.source!=='inherited-story-choices')return 'Decision memory must read actual inherited story choices only.';
    if(!array(r.socialTies)||!r.socialTies.length||r.socialTies.some(t=>!shape(t,['residentId','description'])||!id(t.residentId)||!text(t.description)))return 'Every resident needs explicit social ties.';
    if(!array(r.routine)||!r.routine.length)return 'Every resident needs a complete active-day routine.';
    let minute=0;for(const slot of r.routine){if(!shape(slot,['startMinute','endMinute','activity','placeId','companionIds'])||!Number.isInteger(slot.startMinute)||!Number.isInteger(slot.endMinute)||slot.startMinute!==minute||typeof slot.endMinute!=='number'||slot.endMinute<=minute||slot.endMinute>1440||!text(slot.activity)||!id(slot.placeId)||!places.has(slot.placeId)||!distinctIds(slot.companionIds))return 'Routines need ordered gap-free intervals, registered places and explicit companions.';minute=slot.endMinute;}
    if(minute!==1440)return 'Each routine must cover the full active day.';
    const f=r.family;
    if(shape(f,['kind','ties'])&&f.kind==='local-kin'){
      if(!array(f.ties)||!f.ties.length||f.ties.some(t=>!shape(t,['residentId','kind','description'])||!id(t.residentId)||!['parent','child','sibling','partner','other'].includes(t.kind as string)||!text(t.description)))return 'Local family needs described kin ties.';
    }else if(!shape(f,['kind','explanation'])||f.kind!=='no-local-kin'||!text(f.explanation)||/^(unknown|none|tbd|not set|not established)[.!]?$/i.test(f.explanation))return 'Family absence needs an explicit authored explanation.';
    residents.set(r.id,r as unknown as PeopleLifeResident);
  }
  const memberships=new Set<string>();
  for(const h of households.values())for(const memberId of h.memberIds){
    const resident=residents.get(memberId);if(!resident||resident.homeHouseholdId!==h.id||memberships.has(memberId))return 'Household membership must agree with each resident home exactly once.';memberships.add(memberId);
  }
  const opposite:Record<PeopleLifeKinKind,PeopleLifeKinKind>={parent:'child',child:'parent',sibling:'sibling',partner:'partner',other:'other'};
  for(const r of residents.values()){
    if(!memberships.has(r.id))return 'Every resident must appear in their home household.';
    const social=new Set<string>();for(const tie of r.socialTies){
      const other=residents.get(tie.residentId);if(tie.residentId===r.id||!other||social.has(tie.residentId))return 'Social ties need distinct other registered residents.';social.add(tie.residentId);
      if(!other.socialTies.some(back=>back.residentId===r.id))return 'Social ties need an explicitly authored reciprocal perspective.';
    }
    if(r.family.kind==='local-kin'){
      const seen=new Set<string>();for(const tie of r.family.ties){
        const other=residents.get(tie.residentId);if(!other||other.id===r.id||seen.has(other.id))return 'Kin ties need distinct other registered residents.';seen.add(other.id);
        if(other.family.kind!=='local-kin'||!other.family.ties.some(back=>back.residentId===r.id&&back.kind===opposite[tie.kind]))return 'Kin ties must be explicitly reciprocal with compatible types.';
      }
    }
    for(const slot of r.routine)for(const companionId of slot.companionIds){
      const companion=residents.get(companionId);if(!companion||companionId===r.id)return 'Routine companions must be other registered residents.';
      if(companion.routine.some(other=>other.startMinute<slot.endMinute&&other.endMinute>slot.startMinute&&(other.placeId!==slot.placeId||!other.companionIds.includes(r.id))))return 'Companion routines must agree about their shared place and interval.';
    }
  }
  // Reciprocal descriptions cannot make an impossible ancestry loop valid.
  const incoming=new Map([...residents.keys()].map(id=>[id,0]));
  for(const r of residents.values())if(r.family.kind==='local-kin')for(const tie of r.family.ties)if(tie.kind==='child')incoming.set(tie.residentId,incoming.get(tie.residentId)!+1);
  const queue=[...incoming].filter(([,n])=>n===0).map(([id])=>id);let visited=0;
  for(let at=0;at<queue.length;at++){
    const resident=residents.get(queue[at])!;visited++;
    if(resident.family.kind==='local-kin')for(const tie of resident.family.ties)if(tie.kind==='child'){
      const n=incoming.get(tie.residentId)!-1;incoming.set(tie.residentId,n);if(n===0)queue.push(tie.residentId);
    }
  }
  if(visited!==residents.size)return 'Parent/child ancestry cannot contain a cycle.';
  return null;
}
/** Own/freeze accepted content only; caller objects remain untouched. An empty
 * registry is valid preparation, but no anonymous fallback resident is made. */
export function createPeopleLifeRegistry(value:unknown):PeopleLifeRegistryResult {
  const error=validatePeopleLifeRegistry(value);return error?{ok:false,error}:{ok:true,registry:freezeCopy(value as PeopleLifeRegistry)};
}
export function findPeopleLifeResident(registry:PeopleLifeRegistry,residentId:string):PeopleLifeResident|null {
  return registry.residents.find(r=>r.id===residentId)??null;
}
export interface PeopleLifeDecisionMemory {readonly choiceId:string;readonly optionId:string;readonly at:string;readonly responseLabel:string}
/** Read-only projection of existing decisions. Unknown/replaced options and
 * facts without a real participant record never manufacture remembered events.
 * This compatibility lookup grants no capabilities to particular residents:
 * every explicitly recorded participant reads the same selected response.
 * Future story registries can extend this read seam without new save effects. */
export function getPeopleLifeDecisionMemory(registry:PeopleLifeRegistry,residentId:string,session:Pick<InheritedSession,'choices'>|null):readonly PeopleLifeDecisionMemory[]|null {
  if(!findPeopleLifeResident(registry,residentId))return null;
  const memories:PeopleLifeDecisionMemory[]=[];
  for(const choice of session?.choices??[]){
    if(!choice.personIds.includes(residentId))continue;
    const person=EALDHOLT_PEOPLE_DRAFT.find(p=>p.decision.id===choice.choiceId);
    if(!person||!choice.personIds.includes(person.id))continue;
    const option=person.decision.options.find(o=>o.id===choice.optionId);if(!option)continue;
    memories.push({choiceId:choice.choiceId,optionId:choice.optionId,at:choice.at,responseLabel:option.label});
  }
  return freezeCopy(memories);
}
/** A routine is authored intention, not evidence that an actor moved or that
 * work completed. The host decides how a future NPC presents this projection. */
export function getPeopleLifeRoutine(registry:PeopleLifeRegistry,residentId:string,dayMinute:number):PeopleLifeRoutine|null {
  if(!Number.isFinite(dayMinute)||dayMinute<0||dayMinute>=1440)return null;
  return findPeopleLifeResident(registry,residentId)?.routine.find(s=>dayMinute>=s.startMinute&&dayMinute<s.endMinute)??null;
}
