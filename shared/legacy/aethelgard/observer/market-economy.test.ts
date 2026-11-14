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
