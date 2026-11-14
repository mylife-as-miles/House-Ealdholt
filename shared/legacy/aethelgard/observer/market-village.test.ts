import assert from 'node:assert/strict';
import test from 'node:test';
import {createVillageBuildingDamage,settleVillageBuildingRaid,receiveBuildingAid,startBuildingRebuild,buildingDamageKey} from './building-damage';
import {createMarket,marketPrices} from './market-economy';
import {applyNearMarketDelivery,applyPracticeMarketAction,marketVillagePricing} from './market-village';
import {EMPTY_OBSERVER_SAVE,parseObserverSave,serializeObserverSave} from './observer-save';
import {buildSourceBuildingCatalogue} from './building-damage-catalogue';
import {createBuildingConflagration,stepBuildingConflagration} from './building-conflagration';
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

const binding={catalogueId:'fixture-source',sourceSha256:'a'.repeat(64),profile:'desktop' as const,buildingId:'fixture-house',siteIndex:0};
function burnedSave(){
 const damage=settleVillageBuildingRaid(createVillageBuildingDamage(world,540),{worldKey:world,raidId:'raid-540-0',startMinute:540,settledMinute:540,outcome:'burned',binding,targetLabel:'Fixture house'},540);
 return {...EMPTY_OBSERVER_SAVE,buildingDamage:{status:'valid' as const,state:damage},market:{status:'valid' as const,state:{...createMarket(),timber:14}}};
}
test('a source-bound repair shortage raises actual timber prices without minting or compounding',()=>{
 const start=burnedSave(),price=marketVillagePricing(start,world),basePrice=marketPrices(start.market.state);
 assert.equal(price.available,true);assert.equal(price.damagedBuildings,1);assert.equal(price.timberShortfall,12);assert.equal(price.demandBonus,1);
 assert.equal(price.prices.timberSell,basePrice.timberSell+1);assert.equal(price.prices.timberBuy,basePrice.timberBuy+1);
 const sold=applyPracticeMarketAction(start,world,'sell-timber');assert.equal(sold.ok,true);if(!sold.ok)return;
 const before=start.market.state,after=sold.save.market!.state!;
 assert.equal(after.coins,before.coins+price.prices.timberSell);assert.equal(after.merchantCoins,before.merchantCoins-price.prices.timberSell);
 assert.equal(after.timberDemand,before.timberDemand);assert.equal(marketVillagePricing(sold.save,world).demandBonus,1);
 assert.equal(after.coins+after.merchantCoins,before.coins+before.merchantCoins);
 const quote=marketVillagePricing(sold.save,world).prices.timberBuy,bought=applyPracticeMarketAction(sold.save,world,'buy-timber');assert.equal(bought.ok,true);if(!bought.ok)return;
 const latest=bought.save.market!.state!;assert.equal(latest.coins,after.coins-quote);assert.equal(latest.merchantCoins,after.merchantCoins+quote);assert.equal(latest.timberDemand,after.timberDemand+1);
});
test('repair deliveries relieve the shortage, without changing any building or fabricating work',()=>{
 const start=burnedSave(),before=start.buildingDamage.state.buildings;const result=applyPracticeMarketAction(start,world,'donate-timber');assert.equal(result.ok,true);if(!result.ok)return;
 const price=marketVillagePricing(result.save,world);assert.equal(price.damagedBuildings,1);assert.equal(price.timberShortfall,0);assert.equal(price.demandBonus,0);
 assert.deepEqual(result.save.buildingDamage!.state!.buildings,before);assert.equal(result.save.buildingDamage!.state!.timber,12);
 const again=marketVillagePricing(parseObserverSave(serializeObserverSave(result.save),world),world);assert.deepEqual(again,price);
});
test('unaffordable premiums and unavailable or foreign building data fail closed without mutations',()=>{
 const start=burnedSave(),basePrice=marketPrices(start.market.state).timberSell;
 const poor={...start,market:{status:'valid' as const,state:{...start.market.state,merchantCoins:basePrice}}};
 const refused=applyPracticeMarketAction(poor,world,'sell-timber');assert.equal(refused.ok,false);assert.strictEqual(refused.save,poor);
 const noFunds={...start,market:{status:'valid' as const,state:{...start.market.state,coins:marketPrices(start.market.state).timberBuy}}};
 const noPurchase=applyPracticeMarketAction(noFunds,world,'buy-timber');assert.equal(noPurchase.ok,false);assert.strictEqual(noPurchase.save,noFunds);
 const invalid={...start,buildingFire:{status:'invalid' as const,raw:{},error:'unknown'}};
 assert.equal(marketVillagePricing(invalid,world).available,false);assert.equal(applyPracticeMarketAction(invalid,world,'sell-timber').ok,false);
 assert.equal(applyPracticeMarketAction(invalid,world,'gather').ok,true);
 assert.equal(marketVillagePricing(start,'another-world').available,false);assert.equal(applyPracticeMarketAction(start,'another-world','sell-timber').ok,false);
});
test('sound or already funded rebuilding buildings do not produce an unfunded shortage',()=>{
 const start=burnedSave();let damage=receiveBuildingAid(start.buildingDamage.state,{worldKey:world,raidId:'raid-540-0',deliveredMinute:540,houseId:'aid-house',houseLabel:'Aid house',timber:12,workers:2,labourMinutes:240});
 const funded={...start,buildingDamage:{status:'valid' as const,state:damage}};assert.equal(marketVillagePricing(funded,world).demandBonus,0);
 const repair=startBuildingRebuild(damage,buildingDamageKey(binding),'aid-house');assert.equal(repair.ok,true);if(!repair.ok)return;
 damage=repair.state;const ordered={...start,buildingDamage:{status:'valid' as const,state:damage}};
 assert.equal(marketVillagePricing(ordered,world).damagedBuildings,0);assert.equal(marketVillagePricing(ordered,world).demandBonus,0);
});

test('a changed displayed price is rejected and ledger limits do not partially transfer',()=>{
 const start=burnedSave(),quote=marketVillagePricing(start,world).prices.timberSell;
 const stale=applyPracticeMarketAction(start,world,'sell-timber',quote-1);assert.equal(stale.ok,false);assert.strictEqual(stale.save,start);assert.match(stale.message,/price changed/i);
 const overflow={...start,market:{status:'valid' as const,state:{...start.market.state,coins:1_000_000}}};
 const refused=applyPracticeMarketAction(overflow,world,'sell-timber');assert.equal(refused.ok,false);assert.strictEqual(refused.save,overflow);
});
test('a current fire and its legacy damage record describe only one shortage',()=>{
 const source=buildSourceBuildingCatalogue({sourceSha256:'a'.repeat(64),profile:'desktop',parts:[
 {id:'door',kind:'door',bounds:{min:[0,0,0],max:[4,2,.2]}},
 {id:'wall',kind:'wall',bounds:{min:[0,0,3],max:[4,2,3.2]}},
 {id:'roof',kind:'roof',bounds:{min:[-.2,2,-.2],max:[4.2,2.4,3.4]}}]});
 const target=source.buildings[0];assert.ok(target);
 const outcome={worldKey:world,raidId:'raid-540-0',startMinute:540,settledMinute:540,outcome:'burned' as const,binding:target.binding,targetLabel:'source house'};
 const damage=settleVillageBuildingRaid(createVillageBuildingDamage(world,540),outcome,540);
 const fire=stepBuildingConflagration(createBuildingConflagration({worldKey:world,absoluteMinute:540,seed:world,buildings:source.buildings}),{absoluteMinute:540,damageOutcome:outcome}).state;
 const save={...EMPTY_OBSERVER_SAVE,buildingDamage:{status:'valid' as const,state:damage},buildingFire:{status:'valid' as const,state:fire}};
 const p=marketVillagePricing(save,world);assert.equal(p.available,true);assert.equal(p.damagedBuildings,1);assert.equal(p.timberShortfall,12);assert.equal(p.demandBonus,1);
});
