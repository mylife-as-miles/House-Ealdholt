// SPDX-License-Identifier: Apache-2.0
import fixedHouseholdIds from './market-household-ids.json';

/** Game credits and goods; household transactions are simulated ledger events. */
export interface HouseholdWallet {id:string; coins:number; meals:number; missed:number}
export interface MarketState {
  version: 2; coins: number; timber: number; bread: number; energy: number;
  forest: number; merchantTimber: number; merchantCoins: number;
  bakeryBread: number; bakeryCoins: number; donatedTimber: number; trades: number;
  timberDemand: number; breadDemand: number; day: number;
  supplierCoins:number; households:HouseholdWallet[]; lastFed:number; lastUnfed:number;
}
export const TIMBER_STALL_CAPACITY=20, BAKERY_STALL_CAPACITY=20;
export type MarketAction = 'gather'|'sell-timber'|'buy-timber'|'buy-bread'|'sell-bread'|'bake'|'eat'|'donate-timber'|'next-day'|'broker-bakery';
export interface MarketPrices { timberBuy: number; timberSell: number; bread: number; breadSell:number }
export type MarketResult = {ok:true; state:MarketState; message:string; timberDelivery:number}|{ok:false; state:MarketState; message:string; timberDelivery:0};
const fields=['coins','timber','bread','energy','forest','merchantTimber','merchantCoins','bakeryBread','bakeryCoins','donatedTimber','trades','timberDemand','breadDemand','day'] as const;
const additional=['supplierCoins','lastFed','lastUnfed'] as const;
const bound=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const validNumber=(n:unknown)=>Number.isSafeInteger(n) && (n as number)>=0 && (n as number)<=1_000_000;
// Immutable contract/save order: never reorder IDs after deployment.
export const MARKET_HOUSEHOLD_IDS:readonly string[]=Object.freeze([...fixedHouseholdIds]);
const householdIds=MARKET_HOUSEHOLD_IDS;
const newHouseholds=():HouseholdWallet[]=>householdIds.map(id=>({id,coins:16,meals:0,missed:0}));
export function createMarket():MarketState{return {version:2,coins:16,timber:0,bread:0,energy:4,forest:24,merchantTimber:5,merchantCoins:30,bakeryBread:8,bakeryCoins:20,donatedTimber:0,trades:0,timberDemand:0,breadDemand:0,day:1,supplierCoins:0,households:newHouseholds(),lastFed:0,lastUnfed:0};}
export function parseMarket(value:unknown):MarketState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Market save is invalid.');
  const v=value as Record<string,unknown>, legacy=v.version===1;
  const keys=legacy?['version',...fields]:['version',...fields,...additional,'households'];
  if((v.version!==2&&!legacy)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.prototype.hasOwnProperty.call(v,k))||fields.some(k=>k==='day'?(!Number.isInteger(v[k])||(v[k] as number)<1||(v[k] as number)>0xffffffff):!validNumber(v[k]))||(!legacy&&additional.some(k=>!validNumber(v[k]))))throw Error('Market save is invalid.');
  if((v.energy as number)>8 || (v.forest as number)>24) throw Error('Market resource limit is invalid.');
  let households:HouseholdWallet[];
  if(legacy) households=newHouseholds();
  else {
    if(!Array.isArray(v.households)||v.households.length!==householdIds.length)throw Error('Household wallets are invalid.');
    households=v.households.map((raw,i)=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Household wallet is invalid.');const h=raw as Record<string,unknown>;
      if(Object.keys(h).length!==4||h.id!==householdIds[i]||!validNumber(h.coins)||!validNumber(h.meals)||!validNumber(h.missed))throw Error('Household wallet is invalid.');
      return {id:h.id as string,coins:h.coins as number,meals:h.meals as number,missed:h.missed as number};});
    if((v.lastFed as number)+(v.lastUnfed as number)>householdIds.length)throw Error('Household report is invalid.');
  }
  return {version:2,...Object.fromEntries(fields.map(k=>[k,v[k]])),supplierCoins:legacy?0:v.supplierCoins,households,lastFed:legacy?0:v.lastFed,lastUnfed:legacy?0:v.lastUnfed} as MarketState;
}
/** Adapted from Copper Acorn's Apache-2.0 quote rule (contract/src/economy.rs). */
export function quote(base:number,stock:number,target:number,demand:number) {
  const stockAdjustment=bound(Math.floor(100*(target-Math.min(stock,10000))/(2*target)),-50,75);
  const demandAdjustment=Math.min(demand,6)*5;
  const reference=Math.max(1,Math.floor(base*bound(100+stockAdjustment+demandAdjustment,50,175)/100));
  const bid=Math.max(1,Math.floor(reference*80/100));
  return {bid,ask:Math.max(bid+1,Math.ceil(reference*120/100)),stockAdjustment,demandAdjustment};
}
export function marketPrices(s:MarketState):MarketPrices {
  const timber=quote(5,s.merchantTimber,6,s.timberDemand),bread=quote(4,s.bakeryBread,8,s.breadDemand);
  return {timberSell:timber.bid,timberBuy:timber.ask,bread:bread.ask,breadSell:bread.bid};
}
export function marketAction(old:MarketState,action:MarketAction):MarketResult {
  const s=parseMarket(old), p=marketPrices(s), fail=(message:string):MarketResult=>({ok:false,state:old,message,timberDelivery:0});
  let message:string, timberDelivery=0;
  switch(action){
    case 'gather':
      if(s.energy<1)return fail('You need energy. Buy and eat bread before another supply run.');
      if(s.forest<2)return fail('The commons has no timber left to gather.');
      s.energy--;s.forest-=2;s.timber+=2;message='A supply run brings in 2 timber.';break;
    case 'sell-timber':
      if(s.timber<1)return fail('You have no timber to sell.');
      if(s.merchantTimber>=TIMBER_STALL_CAPACITY)return fail('The timber merchant has no shelf space.');
      if(s.merchantCoins<p.timberSell)return fail('The timber merchant cannot afford another purchase.');
      s.timber--;s.merchantTimber++;s.coins+=p.timberSell;s.merchantCoins-=p.timberSell;s.trades=Math.min(1_000_000,s.trades+1);message=`Sold 1 timber for ${p.timberSell} coins.`;break;
    case 'buy-timber':
      if(s.merchantTimber<1)return fail('The timber merchant is out of stock.');
      if(s.coins<p.timberBuy)return fail('You cannot afford timber at this price.');
      s.coins-=p.timberBuy;s.merchantCoins+=p.timberBuy;s.merchantTimber--;s.timber++;s.timberDemand=Math.min(1_000_000,s.timberDemand+1);s.trades=Math.min(1_000_000,s.trades+1);message=`Bought 1 timber for ${p.timberBuy} coins.`;break;
    case 'buy-bread':
      if(s.bakeryBread<1)return fail('The bakery is out of bread.');
      if(s.coins<p.bread)return fail('You cannot afford bread at this price.');
      s.coins-=p.bread;s.bakeryCoins+=p.bread;s.bakeryBread--;s.bread++;s.breadDemand=Math.min(1_000_000,s.breadDemand+1);s.trades=Math.min(1_000_000,s.trades+1);message=`Bought 1 bread for ${p.bread} coins.`;break;
    case 'sell-bread':
      if(s.bread<1)return fail('You have no bread to sell.');
      if(s.bakeryBread>=BAKERY_STALL_CAPACITY)return fail('The bakery has no shelf space.');
      if(s.bakeryCoins<p.breadSell)return fail('The baker cannot afford another purchase.');
      s.bread--;s.bakeryBread++;s.coins+=p.breadSell;s.bakeryCoins-=p.breadSell;s.trades=Math.min(1_000_000,s.trades+1);message=`Sold 1 bread for ${p.breadSell} coins.`;break;
    case 'broker-bakery':
      if(s.merchantTimber<1)return fail('The woodcutter is out of timber for the baker.');
      if(s.bakeryBread>BAKERY_STALL_CAPACITY-2)return fail('The bakery has no room for another batch.');
      if(s.bakeryCoins<p.timberBuy)return fail('The baker cannot afford fuel at the current timber price.');
      s.bakeryCoins-=p.timberBuy;s.merchantCoins+=p.timberBuy;s.merchantTimber--;s.timberDemand=Math.min(1_000_000,s.timberDemand+1);s.bakeryBread+=2;
      message=`The baker buys fuel from the woodcutter for ${p.timberBuy} coins and bakes 2 bread.`;break;
    case 'bake':
      if(s.timber<1||s.coins<3)return fail('Baking needs 1 timber for fuel and 3 coins for supplies.');
      s.timber--;s.coins-=3;s.supplierCoins+=3;s.bread+=2;message='Used 1 timber and 3 coins of supplies to bake 2 bread.';break;
    case 'eat':
      if(s.bread<1)return fail('Buy or bake bread before eating.');if(s.energy>6)return fail('You already have enough energy.');
      s.bread--;s.energy+=2;message='Bread restores 2 energy.';break;
    case 'next-day': {
      if(s.day>=0xffffffff)return fail('The market has reached its day limit.');
      s.day++;s.energy=Math.min(8,s.energy+1);const regrown=Math.min(2,24-s.forest);s.forest+=regrown;s.timberDemand=Math.floor(s.timberDemand/2);s.breadDemand=Math.floor(s.breadDemand/2);
      // The merchant pays a household wage only from its existing wallet.
      const employee=s.households[(s.day-2)%s.households.length];
      if(s.merchantCoins>=2){s.merchantCoins-=2;employee.coins+=2;}
      // Bake one batch only when the stall can afford fuel and ingredients.
      if(s.bakeryCoins>=3 && s.merchantTimber>=1 && s.bakeryBread<=18){s.bakeryCoins-=3;s.merchantCoins+=3;s.merchantTimber--;s.bakeryBread+=2;}
      s.lastFed=0;s.lastUnfed=0;
      // Rotate first buyer to prevent a permanent advantage to one household.
      for(let i=0;i<s.households.length;i++){
        const h=s.households[(i+s.day-2)%s.households.length],price=marketPrices(s).bread;
        if(s.bakeryBread>0&&h.coins>=price){h.coins-=price;s.bakeryCoins+=price;s.bakeryBread--;s.breadDemand=Math.min(1_000_000,s.breadDemand+1);h.meals=Math.min(1_000_000,h.meals+1);s.lastFed++;}
        else {h.missed=Math.min(1_000_000,h.missed+1);s.lastUnfed++;}
      }
      message=`Market day ${s.day}: the forest regrew ${regrown} timber, and ${s.lastFed} households bought bread; ${s.lastUnfed} could not afford it or found the stall empty.`;break;
    }
    case 'donate-timber':
      if(s.timber<12)return fail('Gather or buy 12 timber for the village repair stores.');
      s.timber-=12;s.donatedTimber+=12;timberDelivery=12;message='12 timber delivered to the village repair stores.';break;
    default:return fail('Unknown market action.');
  }
  try{return {ok:true,state:parseMarket(s),message,timberDelivery};}catch{return fail('The market has reached a ledger limit; nothing was committed.');}
}
