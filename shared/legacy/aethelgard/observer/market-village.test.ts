import assert from 'node:assert/strict';
import test from 'node:test';
import {createVillageBuildingDamage} from './building-damage';
import {createMarket} from './market-economy';
import {applyNearMarketDelivery,applyPracticeMarketAction} from './market-village';
import {EMPTY_OBSERVER_SAVE,parseObserverSave,serializeObserverSave} from './observer-save';
const world='test-village';
const base=()=>({...EMPTY_OBSERVER_SAVE,buildingDamage:{status:'valid' as const,state:createVillageBuildingDamage(world,540)}});
test('market delivery and real repair stock share one durable observer save',()=>{
 const start={...base(),market:{status:'valid' as const,state:{...createMarket(),timber:12}}};
 const result=applyPracticeMarketAction(start,world,'donate-timber');assert.equal(result.ok,true);if(!result.ok)return;
 assert.equal(result.save.buildingDamage?.status,'valid');if(result.save.buildingDamage?.status!=='valid')return;assert.equal(result.save.buildingDamage.state.timber,12);
 assert.equal(result.save.market?.status==='valid'&&result.save.market.state.timber,0);
 const restored=parseObserverSave(serializeObserverSave(result.save),world);assert.equal(restored.buildingDamage?.status==='valid'&&restored.buildingDamage.state.timber,12);assert.equal(restored.market?.status==='valid'&&restored.market.state.donatedTimber,12);
 const again=applyPracticeMarketAction(restored,world,'donate-timber');assert.equal(again.ok,false);assert.strictEqual(again.save,restored);
});
test('delivery refuses unavailable repair state and replayed NEAR receipt without spending',()=>{
 const start={...EMPTY_OBSERVER_SAVE,market:{status:'valid' as const,state:{...createMarket(),timber:12}}};const failed=applyPracticeMarketAction(start,world,'donate-timber');assert.equal(failed.ok,false);assert.strictEqual(failed.save,start);
 const one=applyNearMarketDelivery(base(),world,'market.testnet:alice.testnet:1');assert.equal(one.ok,true);if(!one.ok)return;
 const reloaded=parseObserverSave(serializeObserverSave(one.save),world);const again=applyNearMarketDelivery(reloaded,world,'market.testnet:alice.testnet:1');assert.equal(again.ok,false);assert.strictEqual(again.save,reloaded);
 assert.equal(reloaded.buildingDamage?.status==='valid'&&reloaded.buildingDamage.state.timber,12);
});
test('unknown market or receipt data is preserved and held',()=>{
 const corrupted=parseObserverSave(JSON.stringify({...base(),market:{version:99},nearClaims:['unsafe!']}),world);
 assert.equal(corrupted.market?.status,'invalid');assert.equal(corrupted.nearClaims?.status,'invalid');assert.equal(applyPracticeMarketAction(corrupted,world,'gather').ok,false);assert.equal(applyNearMarketDelivery(corrupted,world,'market.testnet:alice.testnet:1').ok,false);
 const raw=JSON.parse(serializeObserverSave(corrupted));assert.equal(raw.market.version,99);assert.deepEqual(raw.nearClaims,['unsafe!']);
});
