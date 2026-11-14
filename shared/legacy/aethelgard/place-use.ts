/** Coordinate-free physical affordances. A registered anchor is an identity,
 * not proof that a resident can reach it. Navigation owns that later check. */
export interface PlaceHours {readonly start:number;readonly end:number}
export type PlaceAccess={readonly kind:'public'}|{readonly kind:'households'|'residents';readonly ids:readonly string[]};
export interface PlaceResource {
  readonly id:string;readonly placeId:string;readonly anchorId:string;
  readonly kind:'entry'|'sleep'|'stance'|'equipment'|'storage'|'seat'|'service';
  /** Capacity counts verified physical slots, never money, stock or standing.
   * Use separate capacity-one resources for individually positioned beds/seats;
   * this domain does not invent extra poses for a larger slot pool. */
  readonly capacity:number;readonly access:PlaceAccess;readonly hours:readonly PlaceHours[];
}
export interface PlaceUse {
  readonly id:string;readonly placeId:string;readonly kind:'enter'|'sleep'|'work'|'store'|'rest'|'service'|'meet';
  readonly requires:readonly {readonly resourceId:string;readonly units:number}[];
}
export interface PlaceUseCatalog {
  readonly schema:1;readonly anchors:readonly string[];
  readonly residents:readonly {readonly id:string;readonly householdId:string|null}[];
  readonly households:readonly {readonly id:string;readonly homePlaceId:string}[];
  readonly places:readonly {readonly id:string;readonly kind:'home'|'workplace'|'social'|'service';readonly anchorId:string;readonly hours:readonly PlaceHours[]}[];
  readonly resources:readonly PlaceResource[];readonly uses:readonly PlaceUse[];
}
export type PlaceParseResult<T>={readonly ok:true;readonly value:T}|{readonly ok:false;readonly error:string};

/** Shared with the reservation codec: inspect data descriptors BEFORE reads.
 * Neither accessors, custom prototypes nor serialization hooks are invoked. */
export function placeDataRecord(value:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Expected plain place data.');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value);
  if(keys.some(key=>typeof key!=='string'||![...required,...optional].includes(key)||!('value'in descriptors[key]))
    ||required.some(key=>!Object.prototype.hasOwnProperty.call(descriptors,key)))throw Error('Unexpected or incomplete place data.');
  return value as Record<string,unknown>;
}
export function placeDataArray(value:unknown):readonly unknown[]{
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)throw Error('Expected a normal data array.');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value),length=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(!Number.isSafeInteger(length)||length<0||keys.length!==length+1||keys.some(key=>typeof key!=='string'||!('value'in descriptors[key]))
    ||Array.from({length},(_,i)=>String(i)).some(key=>!Object.prototype.hasOwnProperty.call(descriptors,key)))throw Error('Expected a dense data array.');
  return value;
}
export function placeId(value:unknown):string{
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))throw Error('Invalid registered place identifier.');return value;
}
function ids(value:unknown):readonly string[]{const result=placeDataArray(value).map(placeId);if(new Set(result).size!==result.length)throw Error('Duplicate place identifiers.');return Object.freeze(result);}
function unique<T extends {id:string}>(list:readonly T[]):void{if(new Set(list.map(value=>value.id)).size!==list.length)throw Error('Duplicate place catalog identity.');}
function hours(value:unknown):readonly PlaceHours[]{
  if(value===undefined)return Object.freeze([]);
  return Object.freeze(placeDataArray(value).map(item=>{
    const record=placeDataRecord(item,['start','end']),start=record.start,end=record.end;
    if(!Number.isInteger(start)||!Number.isInteger(end)||(start as number)<0||(start as number)>=1440||(end as number)<0||(end as number)>1440||start===end)throw Error('Invalid opening hours.');
    return Object.freeze({start:start as number,end:end as number});
  }));
}
const kind=<T extends string>(value:unknown,allowed:readonly T[]):T=>{if(!allowed.includes(value as T))throw Error('Invalid physical affordance kind.');return value as T;};

/** No names, biographies, coordinates, inventories, clock or storage are seeded. */
export function parsePlaceUseCatalog(input:unknown):PlaceParseResult<PlaceUseCatalog>{
  try{
    const source=placeDataRecord(input,['schema','anchors','residents','households','places','resources','uses']);
    if(source.schema!==1)throw Error('Unsupported place catalog schema.');
    const anchors=ids(source.anchors),residents=placeDataArray(source.residents).map(item=>{
      const record=placeDataRecord(item,['id','householdId']);return Object.freeze({id:placeId(record.id),householdId:record.householdId===null?null:placeId(record.householdId)});
    }),households=placeDataArray(source.households).map(item=>{
      const record=placeDataRecord(item,['id','homePlaceId']);return Object.freeze({id:placeId(record.id),homePlaceId:placeId(record.homePlaceId)});
    }),places=placeDataArray(source.places).map(item=>{
      const record=placeDataRecord(item,['id','kind','anchorId'],['hours']);return Object.freeze({id:placeId(record.id),kind:kind(record.kind,['home','workplace','social','service']),anchorId:placeId(record.anchorId),hours:hours(record.hours)});
    });
    for(const list of [residents,households,places])unique<{id:string}>(list);
    const residentIds=new Set(residents.map(value=>value.id)),householdIds=new Set(households.map(value=>value.id)),anchorIds=new Set(anchors),placeIds=new Set(places.map(value=>value.id));
    if(residents.some(resident=>resident.householdId!==null&&!householdIds.has(resident.householdId))
      ||households.some(household=>!places.some(place=>place.id===household.homePlaceId&&place.kind==='home'))
      ||places.some(place=>!anchorIds.has(place.anchorId)))throw Error('Unregistered household, home or place anchor.');
    const resources=placeDataArray(source.resources).map(item=>{
      const record=placeDataRecord(item,['id','placeId','anchorId','kind','capacity','access'],['hours']);
      const accessRecord=placeDataRecord(record.access,['kind'],['ids']);let access:PlaceAccess;
      if(accessRecord.kind==='public'){if('ids'in accessRecord)throw Error('Public access cannot contain private identities.');access=Object.freeze({kind:'public'});}
      else{const accessKind=kind(accessRecord.kind,['households','residents']),allowed=ids(accessRecord.ids),registered=accessKind==='households'?householdIds:residentIds;
        if(!allowed.length||allowed.some(id=>!registered.has(id)))throw Error('Unregistered resource access.');access=Object.freeze({kind:accessKind,ids:allowed});}
      if(!Number.isSafeInteger(record.capacity)||(record.capacity as number)<1)throw Error('Invalid physical slot capacity.');
      const resource=Object.freeze({id:placeId(record.id),placeId:placeId(record.placeId),anchorId:placeId(record.anchorId),
        kind:kind(record.kind,['entry','sleep','stance','equipment','storage','seat','service']),capacity:record.capacity as number,access,hours:hours(record.hours)});
      if(!placeIds.has(resource.placeId)||!anchorIds.has(resource.anchorId))throw Error('Unregistered resource place or anchor.');return resource;
    });unique(resources);
    const uses=placeDataArray(source.uses).map(item=>{
      const record=placeDataRecord(item,['id','placeId','kind','requires']);
      const requires=placeDataArray(record.requires).map(item=>{const claim=placeDataRecord(item,['resourceId','units']),resourceId=placeId(claim.resourceId),resource=resources.find(value=>value.id===resourceId);
        if(!resource||resource.placeId!==record.placeId||!Number.isSafeInteger(claim.units)||(claim.units as number)<1||(claim.units as number)>resource.capacity)throw Error('Invalid physical resource bundle.');
        return Object.freeze({resourceId,units:claim.units as number});});
      if(!requires.length||new Set(requires.map(claim=>claim.resourceId)).size!==requires.length||!placeIds.has(record.placeId as string))throw Error('Incomplete or duplicate physical resource bundle.');
      const useKind=kind(record.kind,['enter','sleep','work','store','rest','service','meet']);
      const expected={enter:['entry'],sleep:['sleep'],work:['stance'],store:['storage'],rest:['seat'],service:['service'],meet:['seat','stance']}[useKind];
      if(!requires.some(claim=>expected.includes(resources.find(resource=>resource.id===claim.resourceId)!.kind)))throw Error('Use is missing its physical affordance.');
      return Object.freeze({id:placeId(record.id),placeId:placeId(record.placeId),kind:useKind,requires:Object.freeze(requires)});
    });unique(uses);
    return{ok:true,value:Object.freeze({schema:1,anchors,residents:Object.freeze(residents),households:Object.freeze(households),places:Object.freeze(places),resources:Object.freeze(resources),uses:Object.freeze(uses)})};
  }catch(cause){return{ok:false,error:cause instanceof Error?cause.message:'Invalid place catalog.'};}
}

export function canAccessPlaceUse(catalog:PlaceUseCatalog,residentId:string,useId:string):boolean{
  const resident=catalog.residents.find(value=>value.id===residentId),use=catalog.uses.find(value=>value.id===useId);if(!resident||!use)return false;
  return use.requires.every(claim=>{const access=catalog.resources.find(resource=>resource.id===claim.resourceId)?.access;
    return access?.kind==='public'||access?.kind==='residents'&&access.ids.includes(residentId)||access?.kind==='households'&&resident.householdId!==null&&access.ids.includes(resident.householdId);});
}
/** World minutes come from the persistent simulation, never the visit timer.
 * Empty hours means always open; overnight windows are start>end, end-exclusive. */
export function isPlaceUseOpen(catalog:PlaceUseCatalog,useId:string,worldMinute:number):boolean{
  if(!Number.isSafeInteger(worldMinute)||worldMinute<0)return false;const use=catalog.uses.find(value=>value.id===useId);if(!use)return false;
  const minute=worldMinute%1440,open=(windows:readonly PlaceHours[])=>!windows.length||windows.some(window=>window.start<window.end?minute>=window.start&&minute<window.end:minute>=window.start||minute<window.end);
  const place=catalog.places.find(place=>place.id===use.placeId);return !!place&&open(place.hours)&&use.requires.every(claim=>{const resource=catalog.resources.find(resource=>resource.id===claim.resourceId);return !!resource&&open(resource.hours);});
}
