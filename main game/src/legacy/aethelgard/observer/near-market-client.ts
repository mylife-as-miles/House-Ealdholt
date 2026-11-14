import {MARKET_HOUSEHOLD_IDS} from '../../../../../shared/legacy/aethelgard/observer/market-economy';
export const NEAR_TESTNET_RPC='https://rpc.testnet.near.org';
export const validTestnetContract=(s:string)=>s.length<=64 && /^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)*testnet$/.test(s) && s!=='testnet';
export type NearPlayer={coins:number;timber:number;bread:number;energy:number};
export type NearDelivery={id:number;world_hash:string;timber:number};
export type NearTown={forest:number;merchant_timber:number;merchant_coins:number;bakery_bread:number;bakery_coins:number;timber_demand:number;bread_demand:number;day:number};
export type NearHousehold={coins:number;meals:number;missed:number};
export type NearListing={id:number;seller:string;item:'timber'|'bread';quantity:number;unit_price:number;expires_at_ms:number};
export type NearSnapshot={player:NearPlayer|null;town:NearTown;timber_bid:number;timber_ask:number;bread_ask:number;bread_bid:number;deliveries:NearDelivery[];households:NearHousehold[];household_ids:string[];last_fed:number;last_unfed:number;next_day_at_ms:number;listings:NearListing[]};
const number=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=1_000_000;
export function checkNearSnapshot(raw:unknown):NearSnapshot {
 if(!raw||typeof raw!=='object')throw Error('The contract returned an invalid market.');const r=raw as NearSnapshot,t=r.town;
 if(!t||![t.forest,t.merchant_timber,t.merchant_coins,t.bakery_bread,t.bakery_coins,t.timber_demand,t.bread_demand,r.timber_bid,r.timber_ask,r.bread_ask,r.bread_bid,r.last_fed,r.last_unfed].every(number)||!Array.isArray(r.deliveries)||r.deliveries.length>64||r.deliveries.some(d=>!d||!number(d.id)||d.id<1||d.timber!==12||typeof d.world_hash!=='string'||!/^[a-f0-9]{64}$/.test(d.world_hash))||!Number.isInteger(t.day)||t.day<1||t.day>0xffffffff||!Array.isArray(r.household_ids)||r.household_ids.length!==MARKET_HOUSEHOLD_IDS.length||r.household_ids.some((id,i)=>id!==MARKET_HOUSEHOLD_IDS[i])||!Array.isArray(r.households)||r.households.length!==MARKET_HOUSEHOLD_IDS.length||r.households.some(h=>!h||![h.coins,h.meals,h.missed].every(number))||r.last_fed+r.last_unfed>25||!Number.isSafeInteger(r.next_day_at_ms)||r.next_day_at_ms<0||!Array.isArray(r.listings)||r.listings.length>64||r.listings.some(l=>!l||!Number.isInteger(l.id)||l.id<1||l.id>0xffffffff||typeof l.seller!=='string'||l.seller.length>64||!['timber','bread'].includes(l.item)||!number(l.quantity)||l.quantity<1||l.quantity>100||!number(l.unit_price)||l.unit_price<1||l.unit_price>1000||!Number.isSafeInteger(l.expires_at_ms)||l.expires_at_ms<0)||new Set(r.listings.map(l=>l.id)).size!==r.listings.length||r.player!==null&&(!r.player||![r.player.coins,r.player.timber,r.player.bread,r.player.energy].every(number)))throw Error('The contract returned invalid market data.');
 return r;
}
export async function hashWorld(key:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export async function readNearMarket(contract:string,account:string,fetcher:typeof fetch=fetch):Promise<NearSnapshot>{
 if(!validTestnetContract(contract))throw Error('Invalid testnet contract.');
 const response=await fetcher(NEAR_TESTNET_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'ealdholt-market',method:'query',params:{request_type:'call_function',finality:'final',account_id:contract,method_name:'get_market',args_base64:btoa(JSON.stringify({account_id:account}))}})});
 if(!response.ok)throw Error(`NEAR RPC returned HTTP ${response.status}.`);const data=await response.json();if(data.error||!Array.isArray(data.result?.result)||data.result.result.length>65536||data.result.result.some((n:unknown)=>!Number.isInteger(n)||(n as number)<0||(n as number)>255))throw Error('The testnet contract could not be read. Check its account and initialization.');
 return checkNearSnapshot(JSON.parse(new TextDecoder().decode(new Uint8Array(data.result.result))));
}

/** Wallets can return a failed execution outcome without throwing. */
export function assertTransactionAccepted(outcome:unknown):void {
 if(!outcome||typeof outcome!=='object')return;const status=(outcome as {status?:unknown}).status;
 if(status&&typeof status==='object'&&'Failure' in status)throw Error('The transaction failed on NEAR. Refresh the market and try again.');
}
