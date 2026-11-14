import assert from 'node:assert/strict';
import test from 'node:test';
import {canAccessPlaceUse,isPlaceUseOpen,parsePlaceUseCatalog} from '../aethelgard/place-use';

function fixture(){return{schema:1,anchors:['home-door','bed','forge','tool','bench'],
  residents:[{id:'a',householdId:'family'},{id:'b',householdId:null}],households:[{id:'family',homePlaceId:'home'}],
  places:[{id:'home',kind:'home',anchorId:'home-door'},{id:'forge',kind:'workplace',anchorId:'forge',hours:[{start:480,end:1080}]},{id:'square',kind:'social',anchorId:'bench'}],
  resources:[{id:'entry',placeId:'home',anchorId:'home-door',kind:'entry',capacity:1,access:{kind:'households',ids:['family']}},
    {id:'bed',placeId:'home',anchorId:'bed',kind:'sleep',capacity:1,access:{kind:'households',ids:['family']},hours:[{start:1200,end:420}]},
    {id:'stance',placeId:'forge',anchorId:'forge',kind:'stance',capacity:1,access:{kind:'public'}},
    {id:'tool',placeId:'forge',anchorId:'tool',kind:'equipment',capacity:1,access:{kind:'public'}},
    {id:'seat',placeId:'square',anchorId:'bench',kind:'seat',capacity:2,access:{kind:'public'}}],
  uses:[{id:'enter',placeId:'home',kind:'enter',requires:[{resourceId:'entry',units:1}]},{id:'sleep',placeId:'home',kind:'sleep',requires:[{resourceId:'bed',units:1}]},
    {id:'forge-work',placeId:'forge',kind:'work',requires:[{resourceId:'stance',units:1},{resourceId:'tool',units:1}]},{id:'rest',placeId:'square',kind:'rest',requires:[{resourceId:'seat',units:1}]}]};}

test('registered physical places are copied without coordinates, content or privileged resident roles',()=>{
  const input=fixture(),result=parsePlaceUseCatalog(input);assert.ok(result.ok);if(!result.ok)return;
  assert.equal(canAccessPlaceUse(result.value,'a','enter'),true);assert.equal(canAccessPlaceUse(result.value,'b','enter'),false);
  for(const id of ['a','b'])assert.equal(canAccessPlaceUse(result.value,id,'forge-work'),true,'ordinary residents share public work access');
  assert.equal(canAccessPlaceUse(result.value,'missing','rest'),false);
  input.resources[0].capacity=99;input.residents[0].householdId='changed';assert.equal(result.value.resources[0].capacity,1);assert.equal(result.value.residents[0].householdId,'family');
  assert.ok(Object.isFrozen(result.value));assert.ok(Object.isFrozen(result.value.resources[0].access));
});

test('persistent world minutes govern half-open daytime and overnight windows',()=>{
  const parsed=parsePlaceUseCatalog(fixture());assert.ok(parsed.ok);if(!parsed.ok)return;const catalog=parsed.value;
  assert.equal(isPlaceUseOpen(catalog,'forge-work',479),false);assert.equal(isPlaceUseOpen(catalog,'forge-work',480),true);
  assert.equal(isPlaceUseOpen(catalog,'forge-work',1079),true);assert.equal(isPlaceUseOpen(catalog,'forge-work',1080),false);
  for(const minute of [1200,1439,1440,1440+419])assert.equal(isPlaceUseOpen(catalog,'sleep',minute),true);
  for(const minute of [420,1199,1440+420])assert.equal(isPlaceUseOpen(catalog,'sleep',minute),false);
  for(const minute of [-1,.5,Infinity,NaN])assert.equal(isPlaceUseOpen(catalog,'rest',minute),false);
});

test('an unused household home identity needs no invented beds or entry slots, but exposed home uses do',()=>{
  const input=fixture();input.resources=input.resources.filter(resource=>resource.placeId!=='home');input.uses=input.uses.filter(use=>use.placeId!=='home');
  const parsed=parsePlaceUseCatalog(input);assert.ok(parsed.ok);if(!parsed.ok)return;
  assert.equal(parsed.value.households[0].homePlaceId,'home');assert.equal(parsed.value.resources.some(resource=>resource.placeId==='home'),false);
  for(const [id,resourceId,kind]of [['unproved-entry','entry','enter'],['unproved-sleep','bed','sleep']]){
    assert.equal(parsePlaceUseCatalog({...input,uses:[...input.uses,{id,placeId:'home',kind,requires:[{resourceId,units:1}]}]}).ok,false);
  }
  assert.equal(parsePlaceUseCatalog({...input,places:input.places.map(place=>place.id==='home'?{...place,kind:'social'}:place)}).ok,false,'household home reference still requires a registered home place');
});

test('catalog rejects unknown references, invalid capacities, future schemas and nonphysical use bundles',()=>{
  const changes:((input:ReturnType<typeof fixture>)=>void)[]=[input=>{input.schema=2;},
    input=>input.resources[0].capacity=0,input=>input.resources[0].anchorId='unregistered',
    input=>input.uses[0].requires[0].resourceId='missing',input=>input.uses[0].requires[0].units=2,
    input=>input.uses[1].requires[0].resourceId='entry',input=>input.places[1].hours![0].start=1080];
  for(const change of changes){
    const input=fixture();change(input);const before=JSON.stringify(input);assert.equal(parsePlaceUseCatalog(input).ok,false);assert.equal(JSON.stringify(input),before);
  }
  const input=fixture();(input.places[0]as unknown as Record<string,unknown>).position=[1,2,3];assert.equal(parsePlaceUseCatalog(input).ok,false,'private coordinates are not catalog fields');
});

test('catalog parsing rejects getters, array hooks, sparse arrays and extra fields before executing them',()=>{
  let called=0;
  const getter=fixture();Object.defineProperty(getter.resources[0],'capacity',{get(){called++;return 1;},enumerable:true});assert.equal(parsePlaceUseCatalog(getter).ok,false);
  const hook=fixture();Object.assign(hook.anchors,{toJSON(){called++;return[];}});assert.equal(parsePlaceUseCatalog(hook).ok,false);
  const index=fixture();Object.defineProperty(index.resources,0,{get(){called++;return fixture().resources[0];},enumerable:true});assert.equal(parsePlaceUseCatalog(index).ok,false);
  const sparse=fixture();delete(sparse.anchors as unknown[])[1];assert.equal(parsePlaceUseCatalog(sparse).ok,false);
  assert.equal(called,0);
});
