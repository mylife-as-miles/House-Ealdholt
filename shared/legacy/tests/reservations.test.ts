import assert from 'node:assert/strict';
import test from 'node:test';
import {parsePlaceUseCatalog,type PlaceUseCatalog} from '../aethelgard/place-use';
import {cancelPlaceUse,createPlaceReservationBook,parsePlaceReservationBook,reconcilePlaceReservations,releasePlaceUse,requestPlaceUse,
  type PlaceReservationBook,type ReservationTransition} from '../aethelgard/reservations';

function catalog():PlaceUseCatalog{
  const publicAccess={kind:'public'},familyAccess={kind:'households',ids:['family']};
  const parsed=parsePlaceUseCatalog({schema:1,anchors:['home','bed','forge','tool','store','bench','service'],
    residents:['a','b','c','d','e','f'].map(id=>({id,householdId:['a','b','c'].includes(id)?'family':null})),households:[{id:'family',homePlaceId:'home'}],
    places:[{id:'home',kind:'home',anchorId:'home'},{id:'forge',kind:'workplace',anchorId:'forge',hours:[{start:480,end:1080}]},{id:'square',kind:'social',anchorId:'bench'}],
    resources:[{id:'entry',placeId:'home',anchorId:'home',kind:'entry',capacity:1,access:familyAccess},{id:'beds',placeId:'home',anchorId:'bed',kind:'sleep',capacity:2,access:familyAccess},
      {id:'stance',placeId:'forge',anchorId:'forge',kind:'stance',capacity:1,access:publicAccess},{id:'tool',placeId:'forge',anchorId:'tool',kind:'equipment',capacity:1,access:publicAccess},
      {id:'store',placeId:'forge',anchorId:'store',kind:'storage',capacity:1,access:publicAccess},{id:'bench',placeId:'square',anchorId:'bench',kind:'seat',capacity:2,access:publicAccess},
      {id:'service',placeId:'square',anchorId:'service',kind:'service',capacity:1,access:publicAccess}],
    uses:[{id:'enter',placeId:'home',kind:'enter',requires:[{resourceId:'entry',units:1}]},{id:'sleep',placeId:'home',kind:'sleep',requires:[{resourceId:'beds',units:1}]},
      {id:'inspect',placeId:'forge',kind:'work',requires:[{resourceId:'stance',units:1}]},{id:'work',placeId:'forge',kind:'work',requires:[{resourceId:'stance',units:1},{resourceId:'tool',units:1}]},
      {id:'fetch',placeId:'forge',kind:'store',requires:[{resourceId:'store',units:1},{resourceId:'tool',units:1}]},{id:'rest',placeId:'square',kind:'rest',requires:[{resourceId:'bench',units:1}]},
      {id:'service',placeId:'square',kind:'service',requires:[{resourceId:'service',units:1}]},
      {id:'meet-service',placeId:'square',kind:'meet',requires:[{resourceId:'bench',units:1},{resourceId:'service',units:1}]}]});
  if(!parsed.ok)assert.fail(parsed.error);return parsed.value;
}
function next(result:ReservationTransition):PlaceReservationBook{if(!result.ok)assert.fail(result.error);return result.value;}
function status(book:PlaceReservationBook,id:string){return book.requests.find(request=>request.id===id)?.status;}
const ask=(c:PlaceUseCatalog,b:PlaceReservationBook,id:string,residentId:string,useId:string,minute=480)=>next(requestPlaceUse(c,b,{id,residentId,useId},minute));

test('atomic bundles protect older eligible work from bypass while disjoint ordinary uses proceed',()=>{
  const c=catalog();let book=ask(c,createPlaceReservationBook(),'blocker','a','inspect');
  book=ask(c,book,'older','b','work');assert.equal(status(book,'older'),'queued');
  book=ask(c,book,'younger','c','fetch');assert.equal(status(book,'younger'),'queued','the older blocked bundle protects its free tool capacity');
  book=ask(c,book,'unrelated','d','rest');assert.equal(status(book,'unrelated'),'held','unrelated work is not blocked by the queue');
  let result=releasePlaceUse(c,book,'blocker',481);book=next(result);assert.deepEqual(result.ok?result.granted:[],['older']);
  assert.equal(status(book,'older'),'held');assert.equal(status(book,'younger'),'queued');
  result=releasePlaceUse(c,book,'older',482);book=next(result);assert.deepEqual(result.ok?result.granted:[],['younger']);
  assert.equal(status(book,'younger'),'held');assert.equal(status(book,'unrelated'),'held');
  assert.ok(parsePlaceReservationBook(book,c).ok,'every transition emits a valid capacity-safe snapshot');
});

test('physical capacity is shared fairly and cancellation releases the whole bundle before regrant',()=>{
  const c=catalog();let book=createPlaceReservationBook();
  book=ask(c,book,'sleep-a','a','sleep');book=ask(c,book,'sleep-b','b','sleep');book=ask(c,book,'sleep-c','c','sleep');
  assert.equal(status(book,'sleep-a'),'held');assert.equal(status(book,'sleep-b'),'held');assert.equal(status(book,'sleep-c'),'queued');
  const interrupted=cancelPlaceUse(c,book,'sleep-a',481);book=next(interrupted);assert.equal(status(book,'sleep-a'),'cancelled');
  assert.equal(status(book,'sleep-c'),'held');assert.deepEqual(interrupted.ok?interrupted.granted:[],['sleep-c']);
  assert.equal(requestPlaceUse(c,book,{id:'outsider',residentId:'d',useId:'sleep'},481).ok,false);
  assert.equal(requestPlaceUse(c,book,{id:'nested',residentId:'b',useId:'work'},481).ok,false,'a resident cannot hold one use while waiting on another');
});

test('cancelling a queued bundle removes its fairness protection without taking another resident’s held slots',()=>{
  const c=catalog();let book=ask(c,createPlaceReservationBook(),'blocker','a','inspect');
  book=ask(c,book,'older','b','work');book=ask(c,book,'younger','c','fetch');
  const result=cancelPlaceUse(c,book,'older',481);book=next(result);
  assert.equal(status(book,'blocker'),'held');assert.equal(status(book,'older'),'cancelled');assert.equal(status(book,'younger'),'held');
  assert.deepEqual(result.ok?result.granted:[],['younger']);assert.ok(parsePlaceReservationBook(book,c).ok);
});

test('capacity-aware FIFO permits spare seats while preserving an older blocked resident’s required seat',()=>{
  const c=catalog();let book=ask(c,createPlaceReservationBook(),'service-holder','a','service');
  book=ask(c,book,'older-meeting','b','meet-service');assert.equal(status(book,'older-meeting'),'queued');
  book=ask(c,book,'spare-seat','c','rest');assert.equal(status(book,'spare-seat'),'held');
  book=ask(c,book,'later-seat','d','rest');assert.equal(status(book,'later-seat'),'queued');
  book=next(releasePlaceUse(c,book,'service-holder',481));assert.equal(status(book,'older-meeting'),'held');
  assert.equal(status(book,'spare-seat'),'held');assert.equal(status(book,'later-seat'),'queued');
});

test('duplicate request/release/cancel replay is idempotent and payload reuse cannot resurrect a terminal request',()=>{
  const c=catalog(),initial=createPlaceReservationBook();let book=ask(c,initial,'job','a','work');
  assert.deepEqual(ask(c,book,'job','a','work'),book);
  assert.equal(requestPlaceUse(c,book,{id:'job',residentId:'b',useId:'work'},480).ok,false);
  book=next(cancelPlaceUse(c,book,'job',481));assert.deepEqual(next(cancelPlaceUse(c,book,'job',481)),book);
  assert.deepEqual(ask(c,book,'job','a','work',481),book);assert.equal(status(book,'job'),'cancelled');
  book=ask(c,book,'new-job','a','work',481);book=next(releasePlaceUse(c,book,'new-job',482));assert.deepEqual(next(releasePlaceUse(c,book,'new-job',482)),book);
  assert.deepEqual(initial,createPlaceReservationBook(),'no transition mutates the caller snapshot');
});

test('caller-controlled persistent world time opens queued uses without auto-eviction, wall clocks or rewinds',()=>{
  const c=catalog();let book=ask(c,createPlaceReservationBook(479),'early','a','work',479);assert.equal(status(book,'early'),'queued');
  book=next(reconcilePlaceReservations(c,book,480));assert.equal(status(book,'early'),'held');
  book=next(reconcilePlaceReservations(c,book,1080));assert.equal(status(book,'early'),'held','closing hours do not silently interrupt a physical action');
  assert.equal(reconcilePlaceReservations(c,book,1079).ok,false);assert.equal(reconcilePlaceReservations(c,book,NaN).ok,false);
  book=next(releasePlaceUse(c,book,'early',1080));book=ask(c,book,'next-day','a','work',1080);
  book=next(reconcilePlaceReservations(c,book,1440+479));assert.equal(status(book,'next-day'),'queued');
  book=next(reconcilePlaceReservations(c,book,1440+480));assert.equal(status(book,'next-day'),'held');
});

test('a household interruption and save/reload continue the same queue and exactly-once request history',()=>{
  const c=catalog();let book=ask(c,createPlaceReservationBook(360),'leave-home','a','enter',360);
  book=next(releasePlaceUse(c,book,'leave-home',361));book=ask(c,book,'work-a','a','work',480);book=ask(c,book,'work-b','b','work',481);
  book=ask(c,book,'rest-c','c','rest',481);book=next(cancelPlaceUse(c,book,'work-a',482));
  const restored=parsePlaceReservationBook(JSON.parse(JSON.stringify(book)),c);assert.ok(restored.ok);if(!restored.ok)return;
  assert.deepEqual(restored.value,book);assert.equal(status(restored.value,'work-b'),'held');
  const uninterrupted=releasePlaceUse(c,book,'work-b',1080),reloaded=releasePlaceUse(c,restored.value,'work-b',1080);
  assert.deepEqual(reloaded,uninterrupted);book=next(reloaded);book=ask(c,book,'home-a','a','enter',1200);
  book=next(releasePlaceUse(c,book,'home-a',1201));book=ask(c,book,'night-a','a','sleep',1201);
  assert.equal(status(book,'night-a'),'held');assert.equal(book.requests.filter(request=>request.id==='work-a').length,1);
  // These are permission facts only: this pure test proves no route, animation,
  // relationship effect, arrival, actual sleep or completed working day.
});

test('corrupt/future/excess-capacity books and extra-field requests reject without changing caller data',()=>{
  const c=catalog(),book=ask(c,createPlaceReservationBook(),'job','a','work'),before=JSON.stringify(book);
  assert.equal(parsePlaceReservationBook({...book,schema:2},c).ok,false);
  assert.equal(parsePlaceReservationBook({...book,requests:[...book.requests,{...book.requests[0],id:'other',residentId:'b',ticket:2}],nextTicket:3},c).ok,false);
  assert.equal(parsePlaceReservationBook({...book,requests:[{...book.requests[0],useId:'missing'}]},c).ok,false);
  assert.equal(parsePlaceReservationBook({...book,requests:[{...book.requests[0],changedAt:481}]},c).ok,false);
  assert.equal(requestPlaceUse(c,book,{id:'injected',residentId:'b',useId:'rest',chess:{rank:999}},480).ok,false);
  assert.equal(JSON.stringify(book),before);
  let calls=0;const hooked=[...book.requests];Object.assign(hooked,{toJSON(){calls++;return[];}});
  assert.equal(parsePlaceReservationBook({...book,requests:hooked},c).ok,false);
  const request={id:'getter',residentId:'b',get useId(){calls++;return'rest';}};assert.equal(requestPlaceUse(c,book,request,480).ok,false);assert.equal(calls,0);
});
