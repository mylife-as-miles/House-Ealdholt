// SPDX-License-Identifier: Apache-2.0
/** NEAR Hackathon economy: game credits and goods, not real currency.
 * This local practice ledger is kept in the observer save. */
export interface MarketState {
  version: 1; coins: number; timber: number; bread: number; energy: number;
  forest: number; merchantTimber: number; merchantCoins: number;
  bakeryBread: number; bakeryCoins: number; donatedTimber: number; trades: number;
  timberDemand: number; breadDemand: number; day: number;
}
export type MarketAction = 'gather'|'sell-timber'|'buy-timber'|'buy-bread'|'eat'|'donate-timber'|'next-day';
export interface MarketPrices { timberBuy: number; timberSell: number; bread: number }
export type MarketResult = {ok:true; state:MarketState; message:string; timberDelivery:number}|{ok:false; state:MarketState; message:string; timberDelivery:0};
const fields=['coins','timber','bread','energy','forest','merchantTimber','merchantCoins','bakeryBread','bakeryCoins','donatedTimber','trades','timberDemand','breadDemand','day'] as const;
const bound=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
export function createMarket():MarketState{return {version:1,coins:16,timber:0,bread:0,energy:4,forest:24,merchantTimber:5,merchantCoins:30,bakeryBread:8,bakeryCoins:20,donatedTimber:0,trades:0,timberDemand:0,breadDemand:0,day:1};}
export function parseMarket(value:unknown):MarketState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Market save is invalid.');
  const v=value as Record<string,unknown>;
  if(v.version!==1 || Object.keys(v).length!==fields.length+1 || fields.some(k=>!Number.isSafeInteger(v[k]) || (v[k] as number)<0 || (v[k] as number)>1_000_000)) throw Error('Market save is invalid.');
  if((v.energy as number)>8 || (v.forest as number)>24) throw Error('Market resource limit is invalid.');
  return {version:1,...Object.fromEntries(fields.map(k=>[k,v[k]]))} as unknown as MarketState;
}
/** Adapted from Copper Acorn's Apache-2.0 quote rule (contract/src/economy.rs).
 * Stock changes the reference by -50%..+75%; recent demand adds up to 30%.
 * Preserve the spread so buying and immediately selling cannot mint coins. */
export function quote(base:number,stock:number,target:number,demand:number) {
  const stockAdjustment=bound(Math.floor(100*(target-Math.min(stock,10000))/(2*target)),-50,75);
  const demandAdjustment=Math.min(demand,6)*5;
  const reference=Math.max(1,Math.floor(base*bound(100+stockAdjustment+demandAdjustment,50,175)/100));
  const bid=Math.max(1,Math.floor(reference*80/100));
  return {bid,ask:Math.max(bid+1,Math.ceil(reference*120/100)),stockAdjustment,demandAdjustment};
}
export function marketPrices(s:MarketState):MarketPrices {
  const timber=quote(5,s.merchantTimber,6,s.timberDemand),bread=quote(4,s.bakeryBread,8,s.breadDemand);
  return {timberSell:timber.bid,timberBuy:timber.ask,bread:bread.ask};
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
      if(s.merchantCoins<p.timberSell)return fail('The timber merchant cannot afford another purchase.');
      s.timber--;s.merchantTimber++;s.coins+=p.timberSell;s.merchantCoins-=p.timberSell;s.trades++;message=`Sold 1 timber for ${p.timberSell} coins.`;break;
    case 'buy-timber':
      if(s.merchantTimber<1)return fail('The timber merchant is out of stock.');
      if(s.coins<p.timberBuy)return fail('You cannot afford timber at this price.');
      s.coins-=p.timberBuy;s.merchantCoins+=p.timberBuy;s.merchantTimber--;s.timber++;s.timberDemand++;s.trades++;message=`Bought 1 timber for ${p.timberBuy} coins.`;break;
    case 'buy-bread':
      if(s.bakeryBread<1)return fail('The bakery is out of bread.');
      if(s.coins<p.bread)return fail('You cannot afford bread at this price.');
      s.coins-=p.bread;s.bakeryCoins+=p.bread;s.bakeryBread--;s.bread++;s.breadDemand++;s.trades++;message=`Bought 1 bread for ${p.bread} coins.`;break;
    case 'eat':
      if(s.bread<1)return fail('Buy bread before eating.');if(s.energy>6)return fail('You already have enough energy.');
      s.bread--;s.energy+=2;message='Bread restores 2 energy.';break;
    case 'next-day':
      if(s.day>=1000)return fail('The practice market has reached its day limit.');
      s.day++;s.energy=Math.min(8,s.energy+1);s.timberDemand=Math.floor(s.timberDemand/2);s.breadDemand=Math.floor(s.breadDemand/2);
      // The bakery pays for a small batch; no food appears if it is out of funds.
      if(s.bakeryCoins>=3 && s.bakeryBread<=18){s.bakeryCoins-=3;s.bakeryBread+=2;}
      message='A market day passes. Demand cools; the baker bakes if funds permit.';break;
    case 'donate-timber':
      if(s.timber<12)return fail('Gather or buy 12 timber for the village repair stores.');
      s.timber-=12;s.donatedTimber+=12;timberDelivery=12;message='12 timber delivered to the village repair stores.';break;
    default:return fail('Unknown market action.');
  }
  return {ok:true,state:parseMarket(s),message,timberDelivery};
}
