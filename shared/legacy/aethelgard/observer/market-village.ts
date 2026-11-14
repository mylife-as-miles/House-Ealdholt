import {createMarket,marketAction,type MarketAction} from './market-economy';
import {parseVillageBuildingDamage} from './building-damage';
import {addNearClaim} from './near-delivery-claims';
import type {ObserverSave} from './observer-save';

type CommitResult={ok:true;save:ObserverSave;message:string}|{ok:false;save:ObserverSave;message:string};
function withTimber(save:ObserverSave,worldKey:string):ObserverSave {
  if(save.buildingDamage?.status!=='valid')throw Error('Village repair stores are not ready. Your timber was not spent.');
  const old=save.buildingDamage.state;
  const state=parseVillageBuildingDamage({...old,generation:old.generation+1,timber:old.timber+12},worldKey);
  return {...save,buildingDamage:{status:'valid',state}};
}
/** Return a single observer record containing both trade and material delivery.
 * The caller must persist it atomically before publishing either change. */
export function applyPracticeMarketAction(save:ObserverSave,worldKey:string,action:MarketAction):CommitResult {
  try {
    if(save.market?.status==='invalid')throw Error('The saved market is invalid and has been preserved.');
    const result=marketAction(save.market?.state??createMarket(),action);
    if(!result.ok)return {ok:false,save,message:result.message};
    const next=result.timberDelivery?withTimber(save,worldKey):save;
    return {ok:true,save:{...next,market:{status:'valid',state:result.state}},message:result.message};
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
