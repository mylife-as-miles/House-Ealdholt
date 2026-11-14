import test from 'node:test';
import assert from 'node:assert/strict';
import {validTestnetContract,readNearMarket,hashWorld,assertTransactionAccepted} from './near-market-client';
const sample={player:{coins:16,timber:0,bread:0,energy:4},town:{forest:24,merchant_timber:5,merchant_coins:30,bakery_bread:8,bakery_coins:20,timber_demand:0,bread_demand:0,day:1},timber_bid:4,timber_ask:6,bread_ask:5,bread_bid:3,deliveries:[],households:Array.from({length:25},()=>({coins:16,meals:0,missed:0})),last_fed:0,last_unfed:0,next_day_at_ms:60000,listings:[]};
test('reads finalized state from testnet with the chosen account and contract',async()=>{
 let request:any;const mock=async(url:any,init:any)=>{request={url,body:JSON.parse(init.body)};return new Response(JSON.stringify({result:{result:[...new TextEncoder().encode(JSON.stringify(sample))]}}),{status:200});};
 const result=await readNearMarket('market.example.testnet','alice.testnet',mock as typeof fetch);assert.equal(result.player?.coins,16);assert.equal(request.body.params.finality,'final');assert.equal(request.body.params.account_id,'market.example.testnet');assert.deepEqual(JSON.parse(atob(request.body.params.args_base64)),{account_id:'alice.testnet'});
});
test('invalid contracts and malformed RPC responses fail closed',async()=>{
 assert.equal(validTestnetContract('market.near'),false);assert.equal(validTestnetContract('market.example.testnet'),true);
 await assert.rejects(()=>readNearMarket('market.near','alice.testnet'),/Invalid testnet/);
 const bad=async()=>new Response(JSON.stringify({result:{result:[...new TextEncoder().encode(JSON.stringify({...sample,deliveries:[{id:1,timber:99,world_hash:'a'.repeat(64)}]}))]}}));
 await assert.rejects(()=>readNearMarket('market.testnet','alice.testnet',bad as typeof fetch),/invalid market/);
});
test('world identity is deterministic without publishing the raw key',async()=>{const a=await hashWorld('village-one');assert.match(a,/^[a-f0-9]{64}$/);assert.equal(a,await hashWorld('village-one'));assert.notEqual(a,await hashWorld('village-two'));});

test('rejects forged marketplace state and malformed wallet records',async()=>{
 const mock=(payload:unknown)=>async()=>new Response(JSON.stringify({result:{result:[...new TextEncoder().encode(JSON.stringify(payload))]}}));
 await assert.rejects(()=>readNearMarket('market.testnet','alice.testnet',mock({...sample,listings:[{id:1,seller:'alice.testnet',item:'timber',quantity:2,unit_price:-5}]}) as typeof fetch),/invalid market/);
 await assert.rejects(()=>readNearMarket('market.testnet','alice.testnet',mock({...sample,households:[]}) as typeof fetch),/invalid market/);
});

test('failed wallet execution outcomes are not reported as successful',()=>{assert.throws(()=>assertTransactionAccepted({status:{Failure:{ActionError:{}}}}),/failed on NEAR/);assert.doesNotThrow(()=>assertTransactionAccepted({status:{SuccessValue:''}}));assert.doesNotThrow(()=>assertTransactionAccepted(undefined));});
