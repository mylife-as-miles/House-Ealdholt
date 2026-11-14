export const NEAR_TESTNET_RPC='https://rpc.testnet.near.org';
export const validTestnetContract=(s:string)=>s.length<=64 && /^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)*testnet$/.test(s) && s!=='testnet';
export type NearPlayer={coins:number;timber:number;bread:number;energy:number};
export type NearDelivery={id:number;world_hash:string;timber:number};
export type NearTown={forest:number;merchant_timber:number;merchant_coins:number;bakery_bread:number;bakery_coins:number;timber_demand:number;bread_demand:number;day:number};
export type NearSnapshot={player:NearPlayer|null;town:NearTown;timber_bid:number;timber_ask:number;bread_ask:number;deliveries:NearDelivery[]};
const number=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=1_000_000;
export function checkNearSnapshot(raw:unknown):NearSnapshot {
 if(!raw||typeof raw!=='object')throw Error('The contract returned an invalid market.');const r=raw as NearSnapshot,t=r.town;
 if(!t||![t.forest,t.merchant_timber,t.merchant_coins,t.bakery_bread,t.bakery_coins,t.timber_demand,t.bread_demand,t.day,r.timber_bid,r.timber_ask,r.bread_ask].every(number)||!Array.isArray(r.deliveries)||r.deliveries.length>64||r.deliveries.some(d=>!d||!number(d.id)||d.id<1||d.timber!==12||typeof d.world_hash!=='string'||!/^[a-f0-9]{64}$/.test(d.world_hash))||r.player!==null&&(!r.player||![r.player.coins,r.player.timber,r.player.bread,r.player.energy].every(number)))throw Error('The contract returned invalid market data.');
 return r;
}
export async function hashWorld(key:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
export async function readNearMarket(contract:string,account:string,fetcher:typeof fetch=fetch):Promise<NearSnapshot>{
 if(!validTestnetContract(contract))throw Error('Invalid testnet contract.');
 const response=await fetcher(NEAR_TESTNET_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'ealdholt-market',method:'query',params:{request_type:'call_function',finality:'final',account_id:contract,method_name:'get_market',args_base64:btoa(JSON.stringify({account_id:account}))}})});
 if(!response.ok)throw Error(`NEAR RPC returned HTTP ${response.status}.`);const data=await response.json();if(data.error||!Array.isArray(data.result?.result))throw Error('The testnet contract could not be read. Check its account and initialization.');
 return checkNearSnapshot(JSON.parse(new TextDecoder().decode(new Uint8Array(data.result.result))));
}
