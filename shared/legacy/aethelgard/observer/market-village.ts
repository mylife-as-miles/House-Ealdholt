import {createMarket,marketAction,marketPrices,parseMarket,type MarketAction,type MarketPrices} from './market-economy';
import {BUILDING_REBUILD_TIMBER,parseVillageBuildingDamage} from './building-damage';
import {parseBuildingConflagration} from './building-conflagration';
import {buildingDisasterConditions,parseBuildingLocalRebuildOrders} from './building-disaster-session';
import {addNearClaim} from './near-delivery-claims';
import type {ObserverSave} from './observer-save';

type CommitResult={ok:true;save:ObserverSave;message:string}|{ok:false;save:ObserverSave;message:string};

export interface MarketVillagePricing {
  readonly prices:MarketPrices;
  readonly damagedBuildings:number;
  readonly timberShortfall:number;
  readonly demandBonus:number;
  readonly available:boolean;
}
/** A shortage is derived from the current source-bound damage and uncommitted
 * repair stores, never recorded as a new market event. The shared NEAR market
 * has a separate ledger and does not consume this private local village state. */
export function marketVillagePricing(save:ObserverSave,worldKey:string):MarketVillagePricing {
  let market=createMarket();
  try {
    if(save.market?.status==='invalid')throw Error('Market save is invalid.');
    if(save.market?.status==='valid')market=parseMarket(save.market.state);
    if(save.buildingDamage?.status!=='valid'||save.buildingFire?.status==='invalid'||save.localRebuildOrders?.status==='invalid')throw Error('Building state is unavailable.');
    const damage=parseVillageBuildingDamage(save.buildingDamage.state,worldKey);
    const fire=save.buildingFire?.status==='valid'?parseBuildingConflagration(save.buildingFire.state,worldKey):undefined;
    const orders=save.localRebuildOrders?.status==='valid'?parseBuildingLocalRebuildOrders(save.localRebuildOrders.state,worldKey):undefined;
    const checked:ObserverSave={...save,buildingDamage:{status:'valid',state:damage},
      ...(fire?{buildingFire:{status:'valid' as const,state:fire}}:{}),
      ...(orders?{localRebuildOrders:{status:'valid' as const,state:orders}}:{})};
    const damagedBuildings=buildingDisasterConditions(checked).filter(b=>b.condition==='burned').length;
    const timberShortfall=Math.max(0,damagedBuildings*BUILDING_REBUILD_TIMBER-damage.timber);
    const demandBonus=timberShortfall?Math.min(3,Math.ceil(timberShortfall/BUILDING_REBUILD_TIMBER)):0;
    const prices=marketPrices(market);
    return {available:true,damagedBuildings,timberShortfall,demandBonus,
      prices:{...prices,timberBuy:prices.timberBuy+demandBonus,timberSell:prices.timberSell+demandBonus}};
  } catch {
    return {available:false,damagedBuildings:0,timberShortfall:0,demandBonus:0,prices:marketPrices(market)};
  }
}
function withTimber(save:ObserverSave,worldKey:string):ObserverSave {
  if(save.buildingDamage?.status!=='valid')throw Error('Village repair stores are not ready. Your timber was not spent.');
  const old=save.buildingDamage.state;
  const state=parseVillageBuildingDamage({...old,generation:old.generation+1,timber:old.timber+12},worldKey);
  return {...save,buildingDamage:{status:'valid',state}};
}
/** Return a single observer record containing both trade and material delivery.
 * The caller must persist it atomically before publishing either change. */
export function applyPracticeMarketAction(save:ObserverSave,worldKey:string,action:MarketAction,expectedPrice?:number):CommitResult {
  try {
    if(save.market?.status==='invalid')throw Error('The saved market is invalid and has been preserved.');
    const market=save.market?.state??createMarket(),isTimberTrade=action==='sell-timber'||action==='buy-timber';
    const pricing=isTimberTrade?marketVillagePricing(save,worldKey):null;
    if(pricing&&!pricing.available)throw Error('Village building records are unavailable. Timber trading is held.');
    if(pricing&&expectedPrice!==undefined&&(!Number.isSafeInteger(expectedPrice)||expectedPrice!==(action==='sell-timber'?pricing.prices.timberSell:pricing.prices.timberBuy)))throw Error('Timber price changed. Review the current quote before trading.');
    // Apply the derived premium only to this transaction. It is transferred
    // between the real wallets and never becomes persistent market demand.
    const result=marketAction(market,action);
    if(!result.ok)return {ok:false,save,message:result.message};
    const next=result.timberDelivery?withTimber(save,worldKey):save;
    const bonus=pricing?.demandBonus??0;
    if(action==='sell-timber'&&result.state.merchantCoins<bonus)throw Error('The timber merchant cannot afford the repair-demand price.');
    if(action==='buy-timber'&&result.state.coins<bonus)throw Error('You cannot afford timber at the repair-demand price.');
    const state=bonus?parseMarket({...result.state,
      coins:result.state.coins+(action==='sell-timber'?bonus:-bonus),
      merchantCoins:result.state.merchantCoins+(action==='sell-timber'?-bonus:bonus)}):result.state;
    const message=bonus?`${action==='sell-timber'?'Sold':'Bought'} 1 timber for ${action==='sell-timber'?pricing!.prices.timberSell:pricing!.prices.timberBuy} coins, including repair demand.`:result.message;
    return {ok:true,save:{...next,market:{status:'valid',state}},message};
  }catch(error){return {ok:false,save,message:error instanceof Error?error.message:'Market action was held.'};}
}
/** The caller must independently fetch and validate a finalized, world-bound
 * receipt from the configured testnet contract before calling this function. */
export function applyNearMarketDelivery(save:ObserverSave,worldKey:string,id:string):CommitResult {
  try {
    const nearClaims=addNearClaim(save.nearClaims,id),next=withTimber(save,worldKey);
    return {ok:true,save:{...next,nearClaims},message:'Testnet delivery applied once to the village repair stores.'};
  }catch(error){return {ok:false,save,message:error instanceof Error?error.message:'Delivery could not be applied.'};}
}
