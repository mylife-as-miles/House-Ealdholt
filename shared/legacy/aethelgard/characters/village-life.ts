/** Recurring, renderer-independent Ealdholt life. Every record is a simulated
 * routine fact, never proof of an observed arrival, animation, tool or bed.
 * The host supplies the existing population clock; this module owns no time,
 * storage, identities, geography, standing, currency or combat outcomes. */
import { placeDataArray, placeDataRecord } from '../place-use';
import { validateVillagePopulation, type PopulationResident, type VillagePopulation } from './village-population';
import { createResidentSafetyState, advanceResidentSafety, validateResidentSafetyState, validateResidentSafetySignal, parseResidentSafetySignal,
  type ResidentSafetyState, type ResidentSafetySignal } from './resident-safety';

export const VILLAGE_LIFE_SCHEMA = 1 as const;
export const VILLAGE_LIFE_MAX_EVENTS = 256;
export const VILLAGE_LIFE_MAX_ADVANCE_MINUTES = 10080;
export type VillageLifeActivity = 'sleep'|'meal'|'work'|'care'|'visit'|'social'|'patrol'|'travel'|'rest'|'shelter'|'protect'|'home';
export type VillageLifeReason = 'routine'|'family-meal'|'family-care'|'family-visit'|'household-protection'|'weather'|'needs'|'safety';
export interface VillageLifeIntent {
  readonly residentId:string; readonly activityKey:VillageLifeActivity; readonly targetPlaceId:string;
  readonly activity:string; readonly priority:number; readonly issuedAbsoluteMinute:number;
  readonly indoor:boolean; readonly companionIds:readonly string[]; readonly reason:VillageLifeReason;
}
export interface VillageLifeNeeds {readonly hunger:number;readonly fatigue:number;readonly social:number}
export interface VillageLifeCounters {
  readonly dutyMinutes:number;readonly completedDuties:number;readonly mealCount:number;readonly sleepMinutes:number;
  readonly careMinutes:number;readonly visits:number;readonly protectMinutes:number;readonly shelterMinutes:number;
}
export interface VillageLifeRelationship {
  readonly residentId:string;readonly sharedMeals:number;readonly careMinutes:number;readonly visits:number;
}
export interface VillageLifeResident {
  readonly residentId:string;readonly homePlaceId:string;readonly workPlaceId:string;
  readonly intent:VillageLifeIntent;readonly simulatedPlaceId:string;
  readonly status:'active'|'queued'|'unavailable';readonly needs:VillageLifeNeeds;readonly counters:VillageLifeCounters;
  readonly intentProgressMinutes:number;readonly lastMealKey:string|null;readonly lastVisitDay:number|null;
  readonly lastCareDay:number|null;readonly suspendedIntent:VillageLifeIntent|null;readonly suspendedProgressMinutes:number;
  readonly relationships:readonly VillageLifeRelationship[];readonly safety:ResidentSafetyState;
}
export interface VillageLifeHousehold {
  readonly householdId:string;readonly lastSharedMealKey:string|null;readonly sharedMeals:number;
}
export interface VillageLifeReservation {
  readonly resourceId:string;readonly residentId:string;readonly placeId:string;
  readonly activityKey:VillageLifeActivity;readonly sinceMinute:number;readonly scope:'simulation-only';
}
export interface VillageLifeEvent {
  readonly sequence:number;readonly atMinute:number;
  readonly kind:'meal'|'shared-meal'|'duty-completed'|'care'|'visit'|'rested'|'weather-interrupted'|'duty-resumed'|'safety-interrupted';
  readonly actorIds:readonly string[];readonly placeId:string;
  readonly provenance:'simulated-routine';
}
export interface VillageLifeState {
  readonly kind:'village-life';readonly schemaVersion:1;readonly worldKey:string;readonly absoluteMinute:number;
  readonly residents:readonly VillageLifeResident[];readonly households:readonly VillageLifeHousehold[];
  readonly reservations:readonly VillageLifeReservation[];readonly journal:readonly VillageLifeEvent[];
  readonly nextEventSequence:number;
}
export interface VillageLifeConditions {
  readonly weather:'clear'|'overcast'|'rain';readonly daylight:number;
  /** Explicit authored closures, not an absent render/navigation binding. */
  readonly unavailablePlaceIds?:readonly string[];
  readonly careNeededResidentIds?:readonly string[];
}
export interface VillageLifeAdvanceOptions {
  readonly conditionsAt?:(absoluteMinute:number)=>VillageLifeConditions;
  readonly safetySignalsAt?:(absoluteMinute:number)=>readonly ResidentSafetySignal[];
  /** Simulation LOD never changes identity, decisions or saved outcomes. */
  readonly simulationLevel?:'deep'|'scheduled'|'far';
}
export interface VillageLifeExpected {readonly worldKey?:string;readonly absoluteMinute?:number}
export interface VillageLifeSummary {
  readonly absoluteMinute:number;readonly residents:100;readonly households:25;
  readonly working:number;readonly sleeping:number;readonly eating:number;readonly sheltering:number;
  readonly caring:number;readonly visiting:number;readonly protecting:number;readonly queued:number;
  readonly completedDuties:number;readonly sharedMeals:number;readonly careMinutes:number;
}

const ACTIVITIES:readonly VillageLifeActivity[]=['sleep','meal','work','care','visit','social','patrol','travel','rest','shelter','protect','home'];
const REASONS:readonly VillageLifeReason[]=['routine','family-meal','family-care','family-visit','household-protection','weather','needs','safety'];
const COUNTERS=['dutyMinutes','completedDuties','mealCount','sleepMinutes','careMinutes','visits','protectMinutes','shelterMinutes'] as const;
const EVENTS:readonly VillageLifeEvent['kind'][]=['meal','shared-meal','duty-completed','care','visit','rested','weather-interrupted','duty-resumed','safety-interrupted'];
type Context={population:VillagePopulation;people:Map<string,PopulationResident>;places:Set<string>;related:Map<string,readonly string[]>};
const contexts=new WeakMap<VillagePopulation,Context>(),trusted=new WeakSet<object>();
const integer=(n:unknown,max=Number.MAX_SAFE_INTEGER):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=max;
const requireMinute=(n:unknown)=>{if(!integer(n))throw Error('Life needs a safe nonnegative absolute world minute.');return n;};
const clamp=(n:number)=>Math.max(0,Math.min(1000,n));
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
function own<T>(value:T):T {
  // Produced states may share their already immutable intent/report/history
  // subtrees. Rewalking those every single world minute adds avoidable work.
  if(value!==null&&typeof value==='object'&&Object.isFrozen(value))return value;
  // Every mutable subtree is either freshly constructed or copied by the
  // reducer/parser. Freeze that owned data in place rather than rebuilding
  // every key/value pair a second time on each clock boundary.
  if(value!==null&&typeof value==='object'){
    for(const child of Object.values(value))own(child);
    return Object.freeze(value);
  }
  return value;
}
function data(value:unknown,budget={left:100000},depth=0):any {
  if(--budget.left<0||depth>16)throw Error('Life save exceeds its bounded shape budget.');
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=2048)return value;
  if(Array.isArray(value))return placeDataArray(value).map(v=>data(v,budget,depth+1));
  if(!value||typeof value!=='object')throw Error('Life saves contain only finite plain data.');
  const record=placeDataRecord(value,Object.getOwnPropertyNames(value)),out:Record<string,unknown>={};
  for(const key of Object.keys(record))Object.defineProperty(out,key,{value:data(record[key],budget,depth+1),enumerable:true,writable:true});
  return out;
}
function context(population:VillagePopulation):Context {
  const cached=contexts.get(population);if(cached)return cached;
  const error=validateVillagePopulation(population);if(error)throw Error(error);
  if(population.residents.length!==100||population.households.length!==25)throw Error('Village life requires the complete 100-person, 25-household roster.');
  const people=new Map(population.residents.map(r=>[r.id,r])),related=new Map<string,readonly string[]>();
  for(const r of population.residents){
    const kin=r.registry.family.kind==='local-kin'?r.registry.family.ties.map(k=>k.residentId):[];
    const members=population.households.find(h=>h.id===r.householdId)!.memberIds;
    related.set(r.id,[...new Set([...kin,...members,...r.registry.socialTies.map(t=>t.residentId)])].filter(id=>id!==r.id).sort(compare));
  }
  const result={population,people,related,places:new Set(population.registry.places.map(p=>p.id))};
  if(Object.isFrozen(population))contexts.set(population,result);return result;
}
function worldKey(value:unknown):string {
  if(typeof value!=='string'||!value||value.length>2048||value.trim()!==value||/[\u0000-\u001f\u007f]/u.test(value))throw Error('Life requires its confirmed population world identity.');
  return value;
}
function kindOf(activity:string):VillageLifeActivity {
  // This classifies simulated responsibilities, never a skeleton or clip.
  if(activity==='Asleep at home.'||activity==='Sleeps after the night watch.')return 'sleep';
  if(['Breakfast with the household.','Midday meal at home.','Midday meal with the household.','Evening meal with the household.'].includes(activity))return 'meal';
  // Passive warmth and dressing are personal routines, not household crafts.
  // They must not claim the home's work resource or accrue occupational duty.
  if(activity==='Warms by the hearth.')return 'rest';
  if(activity==='Wakes and dresses.')return 'home';
  if(/^(Rests|Sits|Listens|Tells stories|Reads by the fire|Washes before supper)/u.test(activity))return 'rest';
  if(/^(Shares news|Trades work and news|Greets)/u.test(activity))return 'social';
  if(/^(Visits|Sits with an expectant)/u.test(activity))return 'care';
  if(/Patrols|Stands.*watch|Walks the rounds|Sets the night watch/u.test(activity))return 'patrol';
  if(/^(Walks|Travels|Returns|Runs errands|Moves the flock|Brings)/u.test(activity))return 'travel';
  if(/^(Plays|Learns letters)/u.test(activity))return 'social';
  return 'work';
}
function routine(r:PopulationResident,minute:number):VillageLifeIntent {
  const slot=r.registry.routine.find(s=>minute%1440>=s.startMinute&&minute%1440<s.endMinute)!;
  const kind=kindOf(slot.activity),atHome=slot.placeId===r.homePlaceId;
  return {residentId:r.id,activityKey:kind,targetPlaceId:slot.placeId,activity:slot.activity,
    priority:kind==='sleep'?80:kind==='meal'?75:kind==='care'?65:kind==='patrol'?60:40,
    // A complete authored word determines the home threshold. In particular,
    // "indoors" must never acquire an exterior reservation because it contains
    // the letters "door". Explicit indoor wording takes priority over a garden
    // or door mentioned from inside the house.
    issuedAbsoluteMinute:minute,indoor:kind==='sleep'||kind==='meal'||atHome&&(/\bindoors?\b/iu.test(slot.activity)||!/\b(?:outside|outdoors?|doors?|doorsteps?|doorways?|yards?|gardens?)\b/iu.test(slot.activity)),
    companionIds:[...slot.companionIds].sort(compare),reason:kind==='meal'?'family-meal':'routine'};
}
const sameIntent=(a:VillageLifeIntent,b:VillageLifeIntent)=>a.activityKey===b.activityKey&&a.targetPlaceId===b.targetPlaceId&&a.activity===b.activity&&a.reason===b.reason&&a.indoor===b.indoor&&a.priority===b.priority&&a.companionIds.join('\0')===b.companionIds.join('\0');
const blankCounters=():VillageLifeCounters=>({dutyMinutes:0,completedDuties:0,mealCount:0,sleepMinutes:0,careMinutes:0,visits:0,protectMinutes:0,shelterMinutes:0});
export function createVillageLife(population:VillagePopulation,absoluteMinute:number,key:string):VillageLifeState {
  const c=context(population),minute=requireMinute(absoluteMinute);worldKey(key);
  const state:VillageLifeState={kind:'village-life',schemaVersion:1,worldKey:key,absoluteMinute:minute,nextEventSequence:0,journal:[],reservations:[],
    households:population.households.map(h=>({householdId:h.id,lastSharedMealKey:null,sharedMeals:0})),
    residents:population.residents.map(r=>({residentId:r.id,homePlaceId:r.homePlaceId,workPlaceId:r.workPlaceId,intent:routine(r,minute),simulatedPlaceId:r.homePlaceId,
      status:'active',needs:{hunger:200,fatigue:200,social:200},counters:blankCounters(),intentProgressMinutes:0,lastMealKey:null,lastVisitDay:null,lastCareDay:null,
      suspendedIntent:null,suspendedProgressMinutes:0,relationships:c.related.get(r.id)!.map(id=>({residentId:id,sharedMeals:0,careMinutes:0,visits:0})),
      safety:createResidentSafetyState(r.id,minute)}))};
  const result=own(state);trusted.add(result);return result;
}

function intentError(i:VillageLifeIntent,id:string,minute:number,c:Context):void {
  placeDataRecord(i,['residentId','activityKey','targetPlaceId','activity','priority','issuedAbsoluteMinute','indoor','companionIds','reason']);
  if(i.residentId!==id||!ACTIVITIES.includes(i.activityKey)||!REASONS.includes(i.reason)||!c.places.has(i.targetPlaceId)||
    typeof i.activity!=='string'||!i.activity||i.activity.length>400||!integer(i.priority,100)||!integer(i.issuedAbsoluteMinute,minute)||typeof i.indoor!=='boolean')throw Error('Invalid resident life intent.');
  const companions=placeDataArray(i.companionIds);if(new Set(companions).size!==companions.length||companions.some(x=>typeof x!=='string'||x===id||!c.people.has(x)))throw Error('Life intent companions must be other roster residents.');
}
export function parseVillageLife(value:unknown,population:VillagePopulation,expected:VillageLifeExpected={}):VillageLifeState {
  const c=context(population);
  if(value&&typeof value==='object'&&trusted.has(value)){
    const state=value as VillageLifeState;
    if(expected.worldKey!==undefined&&state.worldKey!==expected.worldKey||expected.absoluteMinute!==undefined&&state.absoluteMinute!==expected.absoluteMinute)throw Error('Life identity or clock differs from the population.');
    if(state.residents.some((r,i)=>r.residentId!==population.residents[i]?.id||r.homePlaceId!==population.residents[i]?.homePlaceId||r.workPlaceId!==population.residents[i]?.workPlaceId))throw Error('Life roster differs from the population.');
    return state;
  }
  const s=data(value) as VillageLifeState;
  placeDataRecord(s,['kind','schemaVersion','worldKey','absoluteMinute','residents','households','reservations','journal','nextEventSequence']);
  if(s.kind!=='village-life'||s.schemaVersion!==1)throw Error('Unsupported village life save version.');
  worldKey(s.worldKey);const minute=requireMinute(s.absoluteMinute);requireMinute(s.nextEventSequence);
  if(expected.worldKey!==undefined&&s.worldKey!==expected.worldKey||expected.absoluteMinute!==undefined&&minute!==expected.absoluteMinute)throw Error('Life identity or clock differs from the population.');
  if(!Array.isArray(s.residents)||s.residents.length!==100||!Array.isArray(s.households)||s.households.length!==25)throw Error('Life must retain every resident and household.');
  s.residents.forEach((r,index)=>{
    placeDataRecord(r,['residentId','homePlaceId','workPlaceId','intent','simulatedPlaceId','status','needs','counters','intentProgressMinutes','lastMealKey','lastVisitDay','lastCareDay','suspendedIntent','suspendedProgressMinutes','relationships','safety']);
    const resident=population.residents[index];
    if(r.residentId!==resident.id||r.homePlaceId!==resident.homePlaceId||r.workPlaceId!==resident.workPlaceId||!c.places.has(r.simulatedPlaceId)||!['active','queued','unavailable'].includes(r.status))throw Error('Persisted resident identity/home/work differs from the roster.');
    intentError(r.intent,r.residentId,minute,c);if(r.suspendedIntent!==null)intentError(r.suspendedIntent,r.residentId,minute,c);
    placeDataRecord(r.needs,['hunger','fatigue','social']);if(!Object.values(r.needs).every(n=>integer(n,1000)))throw Error('Life needs must be bounded integers.');
    placeDataRecord(r.counters,COUNTERS);if(!Object.values(r.counters).every(n=>integer(n))||r.counters.completedDuties!==Math.floor(r.counters.dutyMinutes/30))throw Error('Invalid resident duty counters.');
    for(const n of [r.intentProgressMinutes,r.suspendedProgressMinutes])requireMinute(n);
    for(const n of [r.lastVisitDay,r.lastCareDay])if(n!==null&&!integer(n,Math.floor(minute/1440)))throw Error('Future life obligation progress.');
    if(r.lastMealKey!==null&&(typeof r.lastMealKey!=='string'||r.lastMealKey.length>200))throw Error('Invalid meal progress.');
    const related=c.related.get(r.residentId)!;
    if(!Array.isArray(r.relationships)||r.relationships.length!==related.length)throw Error('Life relationships must retain their authored local ties.');
    r.relationships.forEach((tie:VillageLifeRelationship,i:number)=>{placeDataRecord(tie,['residentId','sharedMeals','careMinutes','visits']);if(tie.residentId!==related[i]||![tie.sharedMeals,tie.careMinutes,tie.visits].every(n=>integer(n)))throw Error('Invalid life relationship progress.');});
    const safety=validateResidentSafetyState(r.safety,r.residentId,minute);if(safety)throw Error(safety);
    if(r.safety.lastAbsoluteMinute!==minute)throw Error('Safety and resident life clocks must share one saved cursor.');
    for(const signal of r.safety.knownSignals){const error=validateVillageLifeSafetySignal(signal,population,minute);if(error)throw Error(error);}
    if(r.safety.currentIntent)intentError(r.safety.currentIntent,r.residentId,minute,c);
    if(r.safety.interruptedIntent)intentError(r.safety.interruptedIntent,r.residentId,minute,c);
  });
  s.households.forEach((h,i)=>{placeDataRecord(h,['householdId','lastSharedMealKey','sharedMeals']);if(h.householdId!==population.households[i].id||!integer(h.sharedMeals)||h.lastSharedMealKey!==null&&(typeof h.lastSharedMealKey!=='string'||h.lastSharedMealKey.length>200))throw Error('Invalid household meal progress.');});
  const residentsById=new Map(s.residents.map(r=>[r.residentId,r]));
  for(const resident of s.residents)for(const relationship of resident.relationships){
    const reciprocal=residentsById.get(relationship.residentId)!.relationships.find((t:VillageLifeRelationship)=>t.residentId===resident.residentId);
    if(reciprocal&&(['sharedMeals','careMinutes','visits'] as const).some(key=>relationship[key]!==reciprocal[key]))throw Error('Shared life experiences must agree in both relationship perspectives.');
  }
  if(!Array.isArray(s.reservations)||s.reservations.length>100)throw Error('Life reservation budget exceeded.');
  const resources=new Set<string>(),holders=new Set<string>();
  for(const r of s.reservations){placeDataRecord(r,['resourceId','residentId','placeId','activityKey','sinceMinute','scope']);
    const resident=s.residents.find(p=>p.residentId===r.residentId);
    if(!resident||resources.has(r.resourceId)||holders.has(r.residentId)||typeof r.resourceId!=='string'||!r.resourceId||r.resourceId.length>256||!c.places.has(r.placeId)||!ACTIVITIES.includes(r.activityKey)||!integer(r.sinceMinute,minute)||r.scope!=='simulation-only'||resident.status!=='active'||resident.intent.activityKey!==r.activityKey||resident.intent.targetPlaceId!==r.placeId||resource(resident.intent)!==r.resourceId)throw Error('Invalid or multiply claimed life reservation.');
    resources.add(r.resourceId);holders.add(r.residentId);
  }
  if(!Array.isArray(s.journal)||s.journal.length>VILLAGE_LIFE_MAX_EVENTS)throw Error('Life journal budget exceeded.');
  let previous=-1,lastMinute=-1;
  for(const event of s.journal){placeDataRecord(event,['sequence','atMinute','kind','actorIds','placeId','provenance']);
    if(!integer(event.sequence)||event.sequence!==previous+1&&previous!==-1||event.sequence>=s.nextEventSequence||!integer(event.atMinute,minute)||event.atMinute<lastMinute||!EVENTS.includes(event.kind)||!c.places.has(event.placeId)||event.provenance!=='simulated-routine'||!Array.isArray(event.actorIds)||!event.actorIds.length||event.actorIds.length>100||new Set(event.actorIds).size!==event.actorIds.length||event.actorIds.some((id:string)=>!c.people.has(id)))throw Error('Invalid chronological simulated-life journal.');
    previous=event.sequence;lastMinute=event.atMinute;
  }
  if(s.journal.length&&previous!==s.nextEventSequence-1||!s.journal.length&&s.nextEventSequence!==0)throw Error('Life journal sequence is incomplete.');
  const result=own(s);trusted.add(result);return result;
}
export function validateVillageLife(value:unknown,population:VillagePopulation,expected:VillageLifeExpected={}):string|null {
  try{parseVillageLife(value,population,expected);return null;}catch(cause){return cause instanceof Error?cause.message:'Invalid village life save.';}
}
/** Producers must supply actual authored/witnessed/reported events. A valid
 * shape is not proof that any resident witnessed one; the producer owns that
 * evidence, and only the explicit recipients may act on the resulting fact. */
export function validateVillageLifeSafetySignal(value:unknown,population:VillagePopulation,receivedMinute?:number):string|null {
  try{
    const malformed=validateResidentSafetySignal(value);if(malformed)throw Error(malformed);
    const signal=value as ResidentSafetySignal,c=context(population);
    if(!c.places.has(signal.placeId)||signal.shelterPlaceId!==undefined&&signal.shelterPlaceId!==null&&!c.places.has(signal.shelterPlaceId))throw Error('Safety facts must reference authored village places.');
    if(!signal.knownByResidentIds.length||[...signal.knownByResidentIds,...signal.affectedResidentIds].some(id=>!c.people.has(id)))throw Error('Safety facts must name existing recipients and affected residents.');
    if(receivedMinute!==undefined){requireMinute(receivedMinute);if(signal.observedAbsoluteMinute>receivedMinute||signal.expiresAbsoluteMinute<=receivedMinute)throw Error('Safety facts cannot arrive from the future or after their expiry.');}
    return null;
  }catch(cause){return cause instanceof Error?cause.message:'Invalid village life safety signal.';}
}

type Mutable<T>={-readonly[K in keyof T]:T[K]};
// Only the progress records copied below are mutable. Intents, safety reports
// and their fixed-size position tuples remain shared immutable facts.
type WorkingResident=Omit<Mutable<VillageLifeResident>,'needs'|'counters'|'relationships'>&{
  needs:Mutable<VillageLifeNeeds>;counters:Mutable<VillageLifeCounters>;relationships:Mutable<VillageLifeRelationship>[];
};
type WorkingState=Omit<Mutable<VillageLifeState>,'residents'|'households'|'reservations'|'journal'>&{
  residents:WorkingResident[];households:Mutable<VillageLifeHousehold>[];reservations:VillageLifeReservation[];journal:VillageLifeEvent[];
};
function workingCopy(state:VillageLifeState):WorkingState {
  // This is called only after parseVillageLife has returned an owned, frozen
  // value. Mutable progress is copied; immutable facts remain structurally
  // shared and are never written through by the reducer.
  return {...state,
    residents:state.residents.map(r=>({...r,needs:{...r.needs},counters:{...r.counters},relationships:r.relationships.map(t=>({...t}))})),
    households:state.households.map(h=>({...h})),reservations:[...state.reservations],journal:[...state.journal],
  };
}
function conditions(value:VillageLifeConditions|undefined,c:Context):VillageLifeConditions {
  const result=value??{weather:'clear' as const,daylight:1};
  if(!['clear','overcast','rain'].includes(result.weather)||typeof result.daylight!=='number'||!Number.isFinite(result.daylight)||result.daylight<0||result.daylight>1)throw Error('Life conditions need bounded shared weather/daylight.');
  if(result.unavailablePlaceIds?.some(id=>!c.places.has(id))||result.careNeededResidentIds?.some(id=>!c.people.has(id)))throw Error('Life conditions reference unknown places or residents.');return result;
}
function chooseIntent(r:PopulationResident,state:VillageLifeResident,all:Map<string,VillageLifeResident>,minute:number,weather:VillageLifeConditions,c:Context):VillageLifeIntent {
  const base=routine(r,minute),day=Math.floor(minute/1440),time=minute%1440;
  if(base.activityKey==='sleep'||base.activityKey==='meal')return base;
  if(weather.careNeededResidentIds?.includes(r.id))return{...base,activityKey:'rest',targetPlaceId:r.homePlaceId,activity:'Rests indoors.',priority:88,indoor:true,companionIds:[],reason:'needs'};
  if(state.needs.fatigue>=920)return{...base,activityKey:'rest',targetPlaceId:r.homePlaceId,activity:'Rests indoors.',priority:85,indoor:true,companionIds:[],reason:'needs'};
  const ties=r.registry.family.kind==='local-kin'?r.registry.family.ties:[];
  const candidates=c.related.get(r.id)!.filter(id=>{
    const other=all.get(id)!,person=c.people.get(id)!;
    const coLocated=state.simulatedPlaceId===other.simulatedPlaceId;
    return other.simulatedPlaceId===person.homePlaceId&&(weather.careNeededResidentIds?.includes(id)||coLocated&&(person.ageYears>=58&&other.needs.fatigue>=700||other.needs.hunger>=880));
  });
  candidates.sort((a,b)=>{
    const rank=(id:string)=>ties.some(t=>t.residentId===id&&['parent','child','sibling'].includes(t.kind))?0:c.people.get(id)!.householdId===r.householdId?1:2;
    return rank(a)-rank(b)||compare(a,b);
  });
  if(r.ageYears>=16&&state.needs.fatigue<850&&candidates.length){const id=candidates[0];return{...base,activityKey:'care',targetPlaceId:c.people.get(id)!.homePlaceId,
    activity:'Cares for a relative or household neighbour.',priority:90,indoor:true,companionIds:[id],reason:'family-care'};}
  if(r.ageYears>=16&&time>=840&&time<1020&&state.lastVisitDay!==day){
    const older=ties.map(t=>c.people.get(t.residentId)!).filter(other=>other.ageYears>=58&&other.id!==r.id&&all.get(other.id)!.simulatedPlaceId===other.homePlaceId).sort((a,b)=>b.ageYears-a.ageYears||compare(a.id,b.id));
    let hash=0;for(const ch of r.id)hash=(Math.imul(hash,31)+ch.charCodeAt(0))>>>0;
    if(older.length&&time>=840+hash%120&&time<855+hash%120){const id=older[0].id;return{...base,activityKey:'visit',targetPlaceId:older[0].homePlaceId,
      activity:'Visits an older relative.',priority:65,indoor:true,companionIds:[id],reason:'family-visit'};}
  }
  // Outdoor workers change their task when darkness/rain makes it unsuitable.
  // Guards keep authored night watches; no job/rank gains special powers.
  const outdoors=!base.indoor&&base.activityKey==='work';
  if(outdoors&&(weather.weather==='rain'||weather.daylight<.12))return{...base,activityKey:'shelter',targetPlaceId:r.homePlaceId,
    activity:'Shelters indoors.',priority:70,indoor:true,companionIds:[],reason:'weather'};
  return base;
}
function resource(intent:VillageLifeIntent):string|null {
  if(intent.activityKey==='work')return `work:${intent.targetPlaceId}`;
  if(intent.activityKey==='care')return `care:${intent.companionIds[0]??intent.targetPlaceId}`;
  if(intent.activityKey==='sleep')return `sleep-allocation:${intent.residentId}`;
  if(intent.activityKey==='meal')return `hearth-allocation:${intent.residentId}`;
  return null;
}
export function advanceVillageLife(value:VillageLifeState,population:VillagePopulation,targetMinute:number,options:VillageLifeAdvanceOptions={}):VillageLifeState {
  const state=parseVillageLife(value,population),c=context(population),target=requireMinute(targetMinute);
  if(target<state.absoluteMinute||target-state.absoluteMinute>VILLAGE_LIFE_MAX_ADVANCE_MINUTES)throw Error('Life advancement must be monotonic and bounded to one week.');
  if(options.simulationLevel!==undefined&&!['deep','scheduled','far'].includes(options.simulationLevel))throw Error('Unknown life simulation level.');
  if(target===state.absoluteMinute)return state;
  const next=workingCopy(state);
  const emit=(atMinute:number,kind:VillageLifeEvent['kind'],ids:readonly string[],placeId:string)=>{
    const sequence=next.nextEventSequence++;if(!integer(next.nextEventSequence))throw Error('Life event sequence exhausted.');
    next.journal.push({sequence,atMinute,kind,actorIds:[...new Set(ids)].sort(compare),placeId,provenance:'simulated-routine'});
    if(next.journal.length>VILLAGE_LIFE_MAX_EVENTS)next.journal.splice(0,next.journal.length-VILLAGE_LIFE_MAX_EVENTS);
  };
  for(let minute=state.absoluteMinute+1;minute<=target;minute++){
    // No needs or simulated positions change during the decision pass. The
    // execution pass follows it, so these owned rows form a consistent input
    // view without cloning every resident yet again.
    const weather=conditions(options.conditionsAt?.(minute),c),before=new Map(next.residents.map(r=>[r.residentId,r] as const));
    const signals=options.safetySignalsAt?.(minute)??[];
    if(!Array.isArray(signals)||signals.length>64)throw Error('Life safety feed exceeds its bounded report budget.');
    for(const signal of signals){const invalid=validateVillageLifeSafetySignal(signal,population,minute);if(invalid)throw Error(invalid);}
    const ownedSignals=signals.map(parseResidentSafetySignal);
    const previousReservations=new Map(next.reservations.map(r=>[r.resourceId,r]));
    for(const resident of next.residents){
      const person=c.people.get(resident.residentId)!,old=resident.intent;
      let intent=chooseIntent(person,resident,before,minute,weather,c);
      const safety=advanceResidentSafety({state:resident.safety,absoluteMinute:minute,
        resident:{residentId:person.id,householdId:person.householdId,homePlaceId:person.homePlaceId,ageYears:person.ageYears,roleId:person.roleId,
          kinIds:person.registry.family.kind==='local-kin'?person.registry.family.ties.map(k=>k.residentId):[]},
        routineIntent:intent,signals:ownedSignals,unavailablePlaceIds:weather.unavailablePlaceIds});
      resident.safety=safety.state;if(safety.intent)intent=safety.intent;
      if(sameIntent(old,intent))intent=old;
      else{
        const interrupted=intent.reason==='weather'||intent.reason==='household-protection'||intent.reason==='safety';
        if(interrupted&&old.reason!=='weather'&&old.reason!=='household-protection'&&old.reason!=='safety'){
          // When rain first blocks the next scheduled duty, retain that duty
          // rather than yesterday's/home's already-finished routine slot.
          const blocked=intent.reason==='weather'?routine(person,minute):safety.state.interruptedIntent??old;
          resident.suspendedIntent=blocked;
          resident.suspendedProgressMinutes=sameIntent(old,blocked)?resident.intentProgressMinutes:0;
          emit(minute,intent.reason==='weather'?'weather-interrupted':'safety-interrupted',[person.id],blocked.targetPlaceId);
        }
        const resume=resident.suspendedIntent&&sameIntent(resident.suspendedIntent,intent);
        resident.intentProgressMinutes=resume?resident.suspendedProgressMinutes:0;
        if(resume){emit(minute,'duty-resumed',[person.id],intent.targetPlaceId);resident.suspendedIntent=null;resident.suspendedProgressMinutes=0;}
        else if(!interrupted){resident.suspendedIntent=null;resident.suspendedProgressMinutes=0;}
      }
      // Old intents are immutable and may be retained while only needs and
      // progress change. New intents are owned by this reducer.
      resident.intent=intent;
      resident.status=weather.unavailablePlaceIds?.includes(intent.targetPlaceId)?'unavailable':'active';
    }
    // Logical resource leases prevent double work/care. They assert no
    // geometry: physical seats, beds and tool poses need source bindings.
    const candidates=new Map<string,WorkingResident[]>();
    for(const resident of next.residents){if(resident.status!=='active')continue;const id=resource(resident.intent);if(id){const list=candidates.get(id)??[];list.push(resident);candidates.set(id,list);}}
    next.reservations=[];
    for(const [id,rows]of [...candidates].sort(([a],[b])=>compare(a,b))){
      rows.sort((a,b)=>b.intent.priority-a.intent.priority||compare(a.residentId,b.residentId));
      const highest=rows[0].intent.priority,pool=rows.filter(r=>r.intent.priority===highest),holder=pool[Math.floor(minute/15)%pool.length];
      for(const resident of rows)if(resident!==holder)resident.status='queued';
      const old=previousReservations.get(id);
      next.reservations.push({resourceId:id,residentId:holder.residentId,placeId:holder.intent.targetPlaceId,activityKey:holder.intent.activityKey,
        sinceMinute:old?.residentId===holder.residentId?old.sinceMinute:minute,scope:'simulation-only'});
    }
    for(const resident of next.residents){
      const intent=resident.intent,key=intent.activityKey,counters=resident.counters,active=resident.status==='active';
      resident.needs.hunger=clamp(resident.needs.hunger+1);resident.needs.fatigue=clamp(resident.needs.fatigue+1);resident.needs.social=clamp(resident.needs.social+1);
      if(!active)continue;
      resident.simulatedPlaceId=intent.targetPlaceId;resident.intentProgressMinutes++;
      if(key==='sleep'){resident.needs.fatigue=clamp(resident.needs.fatigue-5);counters.sleepMinutes++;if(resident.intentProgressMinutes===60)emit(minute,'rested',[resident.residentId],intent.targetPlaceId);}
      if(key==='rest'||key==='home'||key==='shelter')resident.needs.fatigue=clamp(resident.needs.fatigue-2);
      if(key==='shelter')counters.shelterMinutes++;
      if(key==='protect')counters.protectMinutes++;
      if(key==='work'||key==='patrol'){
        counters.dutyMinutes++;resident.needs.fatigue=clamp(resident.needs.fatigue+1);
        const completed=Math.floor(counters.dutyMinutes/30);if(completed>counters.completedDuties){counters.completedDuties=completed;emit(minute,'duty-completed',[resident.residentId],intent.targetPlaceId);}
      }
      if(key==='meal'){
        resident.needs.hunger=clamp(resident.needs.hunger-18);resident.needs.social=clamp(resident.needs.social-4);
        const slot=c.people.get(resident.residentId)!.registry.routine.find(s=>minute%1440>=s.startMinute&&minute%1440<s.endMinute)!;
        const mealKey=`${Math.floor(minute/1440)}:${slot.startMinute}:${slot.placeId}`;
        if(resident.intentProgressMinutes>=10&&resident.lastMealKey!==mealKey){resident.lastMealKey=mealKey;counters.mealCount++;emit(minute,'meal',[resident.residentId],intent.targetPlaceId);}
      }
      if(key==='care'){
        const present=intent.companionIds.filter(id=>next.residents.some(r=>r.residentId===id&&r.status==='active'&&r.intent.targetPlaceId===intent.targetPlaceId));
        if(!present.length){resident.intentProgressMinutes--;continue;}
        counters.careMinutes++;resident.lastCareDay=Math.floor(minute/1440);
        for(const id of present){const relative=next.residents.find(r=>r.residentId===id)!;
          relative.needs.fatigue=clamp(relative.needs.fatigue-6);relative.needs.hunger=clamp(relative.needs.hunger-3);relative.needs.social=clamp(relative.needs.social-5);
          const relation=resident.relationships.find(t=>t.residentId===id);if(relation)relation.careMinutes++;
          const reciprocal=relative.relationships.find(t=>t.residentId===resident.residentId);if(reciprocal)reciprocal.careMinutes++;
        }
        if(resident.intentProgressMinutes===10)emit(minute,'care',[resident.residentId,...present],intent.targetPlaceId);
      }
      if(key==='social'||key==='visit')resident.needs.social=clamp(resident.needs.social-5);
      if(key==='visit'&&resident.intentProgressMinutes===10&&intent.companionIds.every(id=>next.residents.some(r=>r.residentId===id&&r.status==='active'&&r.intent.targetPlaceId===intent.targetPlaceId))){counters.visits++;resident.lastVisitDay=Math.floor(minute/1440);
        for(const id of intent.companionIds){const relation=resident.relationships.find(t=>t.residentId===id);if(relation)relation.visits++;
          const reciprocal=next.residents.find(r=>r.residentId===id)?.relationships.find(t=>t.residentId===resident.residentId);if(reciprocal)reciprocal.visits++;}
        emit(minute,'visit',[resident.residentId,...intent.companionIds],intent.targetPlaceId);
      }
    }
    for(const household of next.households){
      const content=population.households.find(h=>h.id===household.householdId)!,members=content.memberIds.map(id=>next.residents.find(r=>r.residentId===id)!);
      const eating=members.filter(r=>r.status==='active'&&r.intent.activityKey==='meal'&&r.simulatedPlaceId===content.homePlaceId&&r.intentProgressMinutes>=10);
      if(eating.length<2)continue;
      const mealKey=eating[0].lastMealKey;if(!mealKey||household.lastSharedMealKey===mealKey)continue;
      household.lastSharedMealKey=mealKey;household.sharedMeals++;
      for(const member of eating)for(const other of eating)if(member!==other){const relation=member.relationships.find(r=>r.residentId===other.residentId);if(relation)relation.sharedMeals++;}
      emit(minute,'shared-meal',eating.map(r=>r.residentId),content.homePlaceId);
    }
    next.absoluteMinute=minute;
  }
  if(next.households.some(h=>!integer(h.sharedMeals))||next.residents.some(r=>!Object.values(r.counters).every(n=>integer(n))||!integer(r.intentProgressMinutes)
    ||r.relationships.some(t=>![t.sharedMeals,t.careMinutes,t.visits].every(n=>integer(n)))))throw Error('Life progress counters exhausted their safe range.');
  const result=own(next) as VillageLifeState;trusted.add(result);return result;
}
export function getVillageLifeResident(state:VillageLifeState,residentId:string):VillageLifeResident|null {
  return state.residents.find(resident=>resident.residentId===residentId)??null;
}
export function summarizeVillageLife(state:VillageLifeState):VillageLifeSummary {
  const active=(key:VillageLifeActivity)=>state.residents.filter(r=>r.status==='active'&&r.intent.activityKey===key).length;
  return Object.freeze({absoluteMinute:state.absoluteMinute,residents:100,households:25,working:active('work')+active('patrol'),sleeping:active('sleep'),eating:active('meal'),sheltering:active('shelter'),
    caring:active('care'),visiting:active('visit'),protecting:active('protect'),queued:state.residents.filter(r=>r.status==='queued').length,
    completedDuties:state.residents.reduce((n,r)=>n+r.counters.completedDuties,0),sharedMeals:state.households.reduce((n,h)=>n+h.sharedMeals,0),careMinutes:state.residents.reduce((n,r)=>n+r.counters.careMinutes,0)});
}
