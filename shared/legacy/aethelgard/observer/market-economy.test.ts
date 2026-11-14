import vectors from './market-quote-vectors.json';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createMarket,marketAction,marketPrices,parseMarket,quote,type MarketAction} from './market-economy';
test('a real trade transfers inventory and money, moves prices and cannot overdraw a merchant',()=>{
 let s=createMarket();s=marketAction(s,'gather').state;const p=marketPrices(s);const sold=marketAction(s,'sell-timber');assert.equal(sold.ok,true);assert.equal(sold.state.coins,s.coins+p.timberSell);assert.equal(sold.state.merchantCoins,s.merchantCoins-p.timberSell);assert.equal(sold.state.merchantTimber,s.merchantTimber+1);
 const poor={...sold.state,merchantCoins:0};const refused=marketAction(poor,'sell-timber');assert.equal(refused.ok,false);assert.strictEqual(refused.state,poor);
 let full={...s,merchantTimber:1};const scarce=marketPrices(full).timberSell;full={...full,merchantTimber:15};assert.ok(marketPrices(full).timberSell<scarce);
});
test('a playable supply loop consumes bread, finite forest and exactly twelve timber',()=>{
 let s=createMarket();const act=(a:MarketAction)=>{const r=marketAction(s,a);assert.equal(r.ok,true,r.message);s=r.state;return r;};
 for(let i=0;i<4;i++)act('gather');assert.equal(marketAction(s,'gather').ok,false);act('buy-bread');act('eat');act('gather');act('gather');assert.equal(s.timber,12);
 const r=act('donate-timber');assert.equal(r.timberDelivery,12);assert.equal(s.timber,0);assert.equal(s.donatedTimber,12);assert.equal(marketAction(s,'donate-timber').ok,false);assert.equal(parseMarket(JSON.parse(JSON.stringify(s))).forest,12);
});
test('bad saves are rejected rather than minted or silently replaced',()=>{assert.throws(()=>parseMarket({...createMarket(),coins:-1}));assert.throws(()=>parseMarket({...createMarket(),unexpected:true}));});

test('the published contract and browser pricing vectors stay identical',()=>{for(const row of vectors){const q=quote(row.base,row.stock,row.target,row.demand);assert.equal(q.bid,row.bid);assert.equal(q.ask,row.ask);}});

test('legacy saves migrate without changing existing balances and reject malformed household wallets',()=>{
 const {supplierCoins,households,lastFed,lastUnfed,...base}=createMarket();
 const old={...base,version:1,coins:7,timber:9};const migrated=parseMarket(old);
 assert.equal(migrated.version,2);assert.equal(migrated.coins,7);assert.equal(migrated.timber,9);assert.equal(migrated.households.length,25);
 assert.throws(()=>parseMarket({...migrated,households:migrated.households.slice(1)}));
 assert.throws(()=>parseMarket({...migrated,households:migrated.households.map((h,i)=>i===0?{...h,coins:-1}:h)}));
});
test('households spend real balances against limited bakery stock and player production restores supply',()=>{
 let state=createMarket();const coins=(s:typeof state)=>s.coins+s.merchantCoins+s.bakeryCoins+s.supplierCoins+s.households.reduce((n,h)=>n+h.coins,0);
 const total=coins(state);const first=marketAction(state,'next-day');assert.equal(first.ok,true);state=first.state;
 assert.equal(state.lastFed,10);assert.equal(state.lastUnfed,15);assert.equal(state.bakeryBread,0);assert.equal(coins(state),total);
 assert.equal(state.households.reduce((n,h)=>n+h.meals,0),10);assert.equal(state.households.reduce((n,h)=>n+h.missed,0),15);
 state=marketAction(state,'gather').state;state=marketAction(state,'bake').state;assert.equal(state.bread,2);assert.equal(coins(state),total);
 const sold=marketAction(state,'sell-bread');assert.equal(sold.ok,true);assert.equal(sold.state.bakeryBread,1);assert.equal(coins(sold.state),total);
 const next=marketAction(sold.state,'next-day');assert.equal(next.ok,true);assert.ok(next.state.lastFed>=1);assert.equal(coins(next.state),total);
});
test('out-of-funds baker and empty stocks do not create goods or overdraw',()=>{
 const state={...createMarket(),bakeryCoins:0,bakeryBread:0,merchantTimber:0,households:createMarket().households.map(h=>({...h,coins:0}))};
 const next=marketAction(state,'next-day');assert.equal(next.ok,true);assert.equal(next.state.bakeryBread,0);assert.equal(next.state.lastFed,0);assert.equal(next.state.lastUnfed,25);
});

test('the commons regenerates gradually without exceeding its original capacity',()=>{
 const initial=createMarket();const gathered=marketAction(initial,'gather');assert.equal(gathered.state.forest,22);
 const tomorrow=marketAction(gathered.state,'next-day');assert.equal(tomorrow.state.forest,24);
 const later=marketAction(tomorrow.state,'next-day');assert.equal(later.state.forest,24);
});

test('complete economic turns agree with the shared contract golden vectors',async()=>{
 const {default:vectors}=await import('./market-turn-vectors.json');let s=createMarket();
 for(const v of vectors){const result=marketAction(s,v.action as MarketAction);assert.equal(result.ok,true,result.message);s=result.state;const p=marketPrices(s);
 assert.deepEqual({action:v.action,coins:s.coins,timber:s.timber,bread:s.bread,energy:s.energy,forest:s.forest,merchant_timber:s.merchantTimber,merchant_coins:s.merchantCoins,bakery_bread:s.bakeryBread,bakery_coins:s.bakeryCoins,timber_demand:s.timberDemand,bread_demand:s.breadDemand,day:s.day,supplier_coins:s.supplierCoins,fed:s.lastFed,unfed:s.lastUnfed,household_coins:s.households.reduce((n,h)=>n+h.coins,0),timber_bid:p.timberSell,timber_ask:p.timberBuy,bread_bid:p.breadSell,bread_ask:p.bread},v);}
});
test('full stalls refuse purchases without spending or taking goods',()=>{
 const timber={...createMarket(),timber:1,merchantTimber:20};const a=marketAction(timber,'sell-timber');assert.equal(a.ok,false);assert.strictEqual(a.state,timber);
 const bread={...createMarket(),bread:1,bakeryBread:20};const b=marketAction(bread,'sell-bread');assert.equal(b.ok,false);assert.strictEqual(b.state,bread);
});

test('a baker can buy fuel from the woodcutter using stall money, but never overdraw or overfill',()=>{
 const start=createMarket(),price=marketPrices(start).timberBuy;const result=marketAction(start,'broker-bakery');assert.equal(result.ok,true);assert.deepEqual([result.state.merchantTimber,result.state.merchantCoins,result.state.bakeryBread,result.state.bakeryCoins,result.state.timberDemand],[4,36,10,14,1]);assert.equal(result.state.bakeryCoins,start.bakeryCoins-price);assert.equal(result.state.merchantCoins,start.merchantCoins+price);assert.equal(result.state.merchantTimber,start.merchantTimber-1);assert.equal(result.state.bakeryBread,start.bakeryBread+2);assert.equal(result.state.timberDemand,start.timberDemand+1);assert.equal(result.state.coins,start.coins);
 for(const blocked of [{...start,bakeryCoins:0},{...start,merchantTimber:0},{...start,bakeryBread:19}]){const refused=marketAction(blocked,'broker-bakery');assert.equal(refused.ok,false);assert.strictEqual(refused.state,blocked);}
});
test('markets continue beyond the old day limit and lifetime household counters saturate',()=>{
 const start={...createMarket(),day:1000,households:createMarket().households.map(h=>({...h,meals:1_000_000,missed:1_000_000}))};
 const r=marketAction(start,'next-day');assert.equal(r.ok,true);assert.equal(r.state.day,1001);assert.ok(r.state.households.every(h=>h.meals<=1_000_000&&h.missed<=1_000_000));
});
test('fixed wallet identities cover the existing roster independently of roster order',async()=>{
 const {MARKET_HOUSEHOLD_IDS}=await import('./market-economy');const {EALDHOLT_VILLAGE_POPULATION}=await import('../characters/village-population');
 assert.equal(new Set(MARKET_HOUSEHOLD_IDS).size,25);assert.deepEqual([...MARKET_HOUSEHOLD_IDS].sort(),EALDHOLT_VILLAGE_POPULATION.households.map(h=>h.id).sort());
 const reordered=[...EALDHOLT_VILLAGE_POPULATION.households].reverse();const labels=new Map(reordered.map(h=>[h.id,h.label]));assert.equal(labels.get(MARKET_HOUSEHOLD_IDS[0]),EALDHOLT_VILLAGE_POPULATION.households[0].label);
});
