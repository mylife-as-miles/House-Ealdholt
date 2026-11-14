import {canAccessPlaceUse,isPlaceUseOpen,placeDataArray,placeDataRecord,placeId,
  type PlaceParseResult,type PlaceUseCatalog} from './place-use';

export type PlaceReservationStatus='queued'|'held'|'released'|'cancelled';
export interface PlaceUseRequest {readonly id:string;readonly residentId:string;readonly useId:string}
export interface PlaceReservation extends PlaceUseRequest {
  readonly ticket:number;readonly status:PlaceReservationStatus;readonly requestedAt:number;readonly changedAt:number;
}
export interface PlaceReservationBook {
  readonly schema:1;readonly nextTicket:number;readonly lastWorldMinute:number;readonly requests:readonly PlaceReservation[];
}
export type ReservationTransition={readonly ok:true;readonly value:PlaceReservationBook;readonly granted:readonly string[]}|{readonly ok:false;readonly error:string};
const minute=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0;
const live=(record:PlaceReservation)=>record.status==='queued'||record.status==='held';

/** One live use per resident avoids holding one bundle while queuing another.
 * Released/cancelled IDs remain factual tombstones for replay idempotence. */
export function createPlaceReservationBook(worldMinute=0):PlaceReservationBook{
  if(!minute(worldMinute))throw Error('Invalid persistent world minute.');
  return Object.freeze({schema:1,nextTicket:1,lastWorldMinute:worldMinute,requests:Object.freeze([])});
}

/** A saved reservation book is a separate domain snapshot, not a LegacySave.
 * It restores queue order/claims, never movement, arrival, action or story. */
export function parsePlaceReservationBook(input:unknown,catalog:PlaceUseCatalog):PlaceParseResult<PlaceReservationBook>{
  try{
    const source=placeDataRecord(input,['schema','nextTicket','lastWorldMinute','requests']);
    if(source.schema!==1)throw Error('Unsupported reservation schema.');
    if(!Number.isSafeInteger(source.nextTicket)||(source.nextTicket as number)<1||!minute(source.lastWorldMinute))throw Error('Invalid reservation clock or ticket.');
    const lastWorldMinute=source.lastWorldMinute;
    const requests=placeDataArray(source.requests).map(item=>{
      const record=placeDataRecord(item,['id','residentId','useId','ticket','status','requestedAt','changedAt']);
      if(!Number.isSafeInteger(record.ticket)||(record.ticket as number)<1||(record.ticket as number)>=(source.nextTicket as number)
        ||!['queued','held','released','cancelled'].includes(record.status as string)||!minute(record.requestedAt)||!minute(record.changedAt)
        ||record.requestedAt>record.changedAt||record.changedAt>lastWorldMinute)throw Error('Invalid saved reservation record.');
      const request=Object.freeze({id:placeId(record.id),residentId:placeId(record.residentId),useId:placeId(record.useId),ticket:record.ticket as number,
        status:record.status as PlaceReservationStatus,requestedAt:record.requestedAt,changedAt:record.changedAt});
      if(!canAccessPlaceUse(catalog,request.residentId,request.useId))throw Error('Saved reservation references an unregistered or inaccessible use.');return request;
    });
    if(new Set(requests.map(request=>request.id)).size!==requests.length||new Set(requests.map(request=>request.ticket)).size!==requests.length
      ||new Set(requests.filter(live).map(request=>request.residentId)).size!==requests.filter(live).length)throw Error('Duplicate reservation or live resident use.');
    const occupied=new Map<string,number>();
    for(const request of requests)if(request.status==='held')for(const claim of catalog.uses.find(use=>use.id===request.useId)!.requires){
      const used=(occupied.get(claim.resourceId)??0)+claim.units,capacity=catalog.resources.find(resource=>resource.id===claim.resourceId)!.capacity;
      if(!Number.isSafeInteger(used)||used>capacity)throw Error('Saved reservations exceed physical slot capacity.');occupied.set(claim.resourceId,used);
    }
    return{ok:true,value:Object.freeze({schema:1,nextTicket:source.nextTicket as number,lastWorldMinute,requests:Object.freeze(requests)})};
  }catch(cause){return{ok:false,error:cause instanceof Error?cause.message:'Invalid reservation book.'};}
}

type MutableReservation={-readonly [Key in keyof PlaceReservation]:PlaceReservation[Key]};
function transition(catalog:PlaceUseCatalog,input:PlaceReservationBook,worldMinute:number,
  edit:(context:{requests:MutableReservation[];nextTicket:number})=>void):ReservationTransition{
  const parsed=parsePlaceReservationBook(input,catalog);if(!parsed.ok)return parsed;
  if(!minute(worldMinute)||worldMinute<parsed.value.lastWorldMinute)return{ok:false,error:'Reservation time cannot rewind or use the presentation clock.'};
  try{
    const context={requests:parsed.value.requests.map(request=>({...request})),nextTicket:parsed.value.nextTicket};edit(context);
    const occupied=new Map<string,number>(),protectedCapacity=new Map<string,number>(),granted:string[]=[];
    const requirements=(useId:string)=>catalog.uses.find(use=>use.id===useId)!.requires;
    const capacity=(resourceId:string)=>catalog.resources.find(resource=>resource.id===resourceId)!.capacity;
    for(const request of context.requests)if(request.status==='held')for(const claim of requirements(request.useId))occupied.set(claim.resourceId,(occupied.get(claim.resourceId)??0)+claim.units);
    for(const request of context.requests.filter(request=>request.status==='queued').sort((a,b)=>a.ticket-b.ticket)){
      if(!isPlaceUseOpen(catalog,request.useId,worldMinute))continue;
      const claims=requirements(request.useId);
      if(claims.every(claim=>(occupied.get(claim.resourceId)??0)+(protectedCapacity.get(claim.resourceId)??0)+claim.units<=capacity(claim.resourceId))){
        request.status='held';request.changedAt=worldMinute;granted.push(request.id);
        for(const claim of claims)occupied.set(claim.resourceId,(occupied.get(claim.resourceId)??0)+claim.units);
      }else{
        // An older eligible blocked bundle protects only its required capacity.
        // Disjoint work can proceed; younger requests cannot starve its tools.
        for(const claim of claims)protectedCapacity.set(claim.resourceId,Math.min(capacity(claim.resourceId),(protectedCapacity.get(claim.resourceId)??0)+claim.units));
      }
    }
    return{ok:true,value:Object.freeze({schema:1,nextTicket:context.nextTicket,lastWorldMinute:worldMinute,
      requests:Object.freeze(context.requests.map(request=>Object.freeze(request)))}),granted:Object.freeze(granted)};
  }catch(cause){return{ok:false,error:cause instanceof Error?cause.message:'Reservation transition failed.'};}
}

/** Atomic bundles only. A grant reserves slots; it is NOT physical arrival or
 * action completion. The navigation/action owner must prove those separately. */
export function requestPlaceUse(catalog:PlaceUseCatalog,book:PlaceReservationBook,input:unknown,worldMinute:number):ReservationTransition{
  return transition(catalog,book,worldMinute,context=>{
    const record=placeDataRecord(input,['id','residentId','useId']),id=placeId(record.id),residentId=placeId(record.residentId),useId=placeId(record.useId);
    const existing=context.requests.find(request=>request.id===id);
    if(existing){if(existing.residentId!==residentId||existing.useId!==useId)throw Error('Reservation ID cannot be reused for another request.');return;}
    if(!canAccessPlaceUse(catalog,residentId,useId))throw Error('Resident cannot use this registered place.');
    if(context.requests.some(request=>request.residentId===residentId&&live(request)))throw Error('Resident already has a queued or held use.');
    if(context.nextTicket>=Number.MAX_SAFE_INTEGER)throw Error('Reservation ticket range exhausted.');
    context.requests.push({id,residentId,useId,ticket:context.nextTicket++,status:'queued',requestedAt:worldMinute,changedAt:worldMinute});
  });
}
function endUse(catalog:PlaceUseCatalog,book:PlaceReservationBook,id:string,worldMinute:number,cancel:boolean):ReservationTransition{
  return transition(catalog,book,worldMinute,context=>{
    const request=context.requests.find(request=>request.id===placeId(id));if(!request)throw Error('Unknown reservation.');
    if(!live(request))return;
    if(!cancel&&request.status!=='held')throw Error('Cancel a queued request instead of releasing unheld slots.');
    request.status=cancel?'cancelled':'released';request.changedAt=worldMinute;
  });
}
export function releasePlaceUse(catalog:PlaceUseCatalog,book:PlaceReservationBook,id:string,worldMinute:number):ReservationTransition{return endUse(catalog,book,id,worldMinute,false);}
export function cancelPlaceUse(catalog:PlaceUseCatalog,book:PlaceReservationBook,id:string,worldMinute:number):ReservationTransition{return endUse(catalog,book,id,worldMinute,true);}
/** The caller's bounded persistent-world stepping invokes this. There is no
 * internal timer, offline penalty, automatic eviction or catch-up loop. */
export function reconcilePlaceReservations(catalog:PlaceUseCatalog,book:PlaceReservationBook,worldMinute:number):ReservationTransition{return transition(catalog,book,worldMinute,()=>{});}
