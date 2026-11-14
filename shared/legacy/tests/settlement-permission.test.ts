import assert from 'node:assert/strict';
import test from 'node:test';
import { environmentFixture } from '../environment/fixtures';
import { SettlementEnvironmentController, AUTUMN_DEFAULT_PLACEMENTS } from '../environment/settlement/controller';
import { settlementStorageKey } from '../settlement/storage';
import { LEGACY_STORAGE_KEY } from '../domain/persistence';

function withDeviceStorage(run:(storage:{values:Map<string,string>;reads:string[];writes:string[]})=>void){
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const storage={values:new Map<string,string>(),reads:[] as string[],writes:[] as string[],getItem(key:string){this.reads.push(key);return this.values.get(key)??null;},setItem(key:string,value:string){this.writes.push(key);this.values.set(key,value);},removeItem(key:string){this.values.delete(key);}};
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
 try{run(storage);}finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete (globalThis as {localStorage?:unknown}).localStorage;}
}
const bannerId='permission-banner',key=settlementStorageKey(bannerId,'bannerhold');
const base={...environmentFixture('founded'),bannerId,mode:'production' as const};
const clearSurface={bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},groundAt:()=>0,dryAt:()=>true,obstacles:[],paths:[]};

test('production mode alone does not authorize guest or unknown-session estate persistence',()=>{
 withDeviceStorage(storage=>{
  storage.values.set(LEGACY_STORAGE_KEY,'existing private house bytes');
  storage.values.set(key,JSON.stringify({version:1,bannerId,worldId:'bannerhold',placements:[]}));
  for(const permission of [false,undefined]){
   const controller=new SettlementEnvironmentController({...base,estatePersistent:permission},'bannerhold',clearSurface,AUTUMN_DEFAULT_PLACEMENTS);
   assert.equal(controller.getSettlementSnapshot().placements.length,0,'guest does not load a stored estate or retired defaults');
   assert.equal(controller.setSettlementTool('cottage'),true);assert.equal(controller.commitSettlementPlacement(),true,'guest can arrange an in-memory estate');
   assert.equal(controller.getSettlementSnapshot().placements.length,1);controller.dispose();
  }
  assert.deepEqual(storage.reads,[]);assert.deepEqual(storage.writes,[]);assert.equal(storage.values.get(LEGACY_STORAGE_KEY),'existing private house bytes');
 });
});

test('current host permission gates building edits without resetting layouts or changing house bytes',()=>{
 withDeviceStorage(storage=>{
  storage.values.set(LEGACY_STORAGE_KEY,'existing private house bytes');
  const state={...base,estatePersistent:true},controller=new SettlementEnvironmentController(state,'bannerhold',clearSurface,AUTUMN_DEFAULT_PLACEMENTS);
  controller.setSettlementTool('cottage');assert.equal(controller.commitSettlementPlacement(),true);assert.deepEqual(storage.writes,[key]);
  const first=controller.getSettlementSnapshot().selectedId!,saved=storage.values.get(key),initial=controller.getSettlementSnapshot().placements;
  controller.setState({...state,estatePersistent:false});assert.deepEqual(controller.getSettlementSnapshot().placements,initial);
  controller.setSettlementTool('storehouse');controller.setSettlementCursor(25,25);assert.equal(controller.commitSettlementPlacement(),true);
  assert.deepEqual(storage.writes,[key]);assert.equal(storage.values.get(key),saved,'a guest edit does not overwrite persistent device state');
  controller.setState(state);assert.equal(controller.getSettlementSnapshot().placements.length,2);
  assert.deepEqual(storage.writes,[key],'permission changes do not silently autosave');
  assert.equal(controller.deleteSettlementPlacement(first),true);assert.deepEqual(storage.writes,[key,key]);
  const persisted=JSON.parse(storage.values.get(key)!).placements;
  assert.equal(persisted.length,1);assert.equal(persisted[0].kind,'storehouse');
  assert.equal(storage.values.get(LEGACY_STORAGE_KEY),'existing private house bytes');controller.dispose();
 });
});

test('development preview cannot persist even if a stale host flag says it may save',()=>{
 withDeviceStorage(storage=>{
  const controller=new SettlementEnvironmentController({...base,mode:'preview',estatePersistent:true},'bannerhold',clearSurface,AUTUMN_DEFAULT_PLACEMENTS);
  controller.setSettlementTool('pavilion');assert.equal(controller.commitSettlementPlacement(),true);
  assert.equal(controller.deleteSettlementPlacement(),true);assert.deepEqual(storage.reads,[]);assert.deepEqual(storage.writes,[]);controller.dispose();
 });
});
