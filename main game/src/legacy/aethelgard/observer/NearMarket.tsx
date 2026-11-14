import {useCallback,useEffect,useRef,useState} from 'react';
import type {WalletSelector,InjectedWallet} from '@near-wallet-selector/core';
import {EALDHOLT_VILLAGE_POPULATION} from '../../../../../shared/legacy/aethelgard/characters/village-population';
import type {MarketAction} from '../../../../../shared/legacy/aethelgard/observer/market-economy';

import {validTestnetContract,readNearMarket,hashWorld,assertTransactionAccepted,type NearSnapshot} from './near-market-client';
const CONTRACT_KEY='house-ealdholt.near-testnet-contract';
let selectorPromise:Promise<WalletSelector>|null=null;let selectorContract='';
async function selectorFor(contract:string){
 if(selectorContract!==contract){selectorPromise=null;selectorContract=contract;}
 if(!selectorPromise){const pending=(async()=>{const [{setupWalletSelector},{setupMyNearWallet}]=await Promise.all([import('@near-wallet-selector/core'),import('@near-wallet-selector/my-near-wallet')]);return setupWalletSelector({network:'testnet',modules:[setupMyNearWallet()],createAccessKeyFor:{contractId:contract,methodNames:['join','act','create_listing','buy_listing','cancel_listing']}});})();selectorPromise=pending;void pending.catch(()=>{if(selectorPromise===pending)selectorPromise=null;});}
 return selectorPromise;
}
export function NearMarket({worldKey,claims,onClaim}:{worldKey:string;claims:readonly string[]|null;onClaim(id:string):void}){
 const [contract,setContract]=useState(()=>{try{return localStorage.getItem(CONTRACT_KEY)??'';}catch{return '';}});
 const [account,setAccount]=useState(''),[data,setData]=useState<NearSnapshot|null>(null),[hash,setHash]=useState('');
 const refreshGeneration=useRef(0);
 const [item,setItem]=useState<'timber'|'bread'>('timber'),[quantity,setQuantity]=useState('1'),[price,setPrice]=useState('5');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('Testnet is separate from the local market. Connect your own wallet and deployed contract.');
 useEffect(()=>{let live=true;void hashWorld(worldKey).then(v=>{if(live)setHash(v)}).catch(()=>{if(live)setMessage('Secure context required for the village identifier.');});return()=>{live=false;};},[worldKey]);
 const refresh=useCallback(async(id:string,who:string)=>{const generation=++refreshGeneration.current;const next=await readNearMarket(id,who);if(generation!==refreshGeneration.current)return;setData(next);setMessage('Showing finalized NEAR testnet state. Transactions require your wallet approval.');},[]);
 useEffect(()=>{if(!validTestnetContract(contract))return;let live=true;void(async()=>{try{const selector=await selectorFor(contract);if(!selector.isSignedIn())return;const wallet=await selector.wallet();const [first]=await wallet.getAccounts();if(live&&first){setAccount(first.accountId);await refresh(contract,first.accountId);}}catch(e){if(live)setMessage(e instanceof Error?e.message:'Could not restore wallet.');}})();return()=>{live=false;refreshGeneration.current++;};},[contract,refresh]);
 const connect=async()=>{if(!validTestnetContract(contract)){setMessage('Enter a valid contract account ending in .testnet.');return;}setBusy(true);try{localStorage.setItem(CONTRACT_KEY,contract);const selector=await selectorFor(contract),wallet=await selector.wallet<InjectedWallet>('my-near-wallet');const accounts=await wallet.signIn({contractId:contract,methodNames:['join','act','create_listing','buy_listing','cancel_listing']});if(accounts?.[0]){setAccount(accounts[0].accountId);await refresh(contract,accounts[0].accountId);}else setMessage('Continue in your wallet; return here afterward.');}catch(e){setMessage(e instanceof Error?e.message:'Wallet connection failed.');}finally{setBusy(false);}};
 const call=async(action:MarketAction|'join')=>{if(!account||!data||(action==='donate-timber'&&!hash))return;setBusy(true);try{const selector=await selectorFor(contract),wallet=await selector.wallet(),{actionCreators}=await import('@near-wallet-selector/core');
  const limit=action==='sell-timber'?data.timber_bid:action==='buy-timber'?data.timber_ask:action==='buy-bread'?data.bread_ask:action==='sell-bread'?data.bread_bid:0;
  const args=action==='join'?{}:{action,limit,world_hash:action==='donate-timber'?hash:null};
  assertTransactionAccepted(await wallet.signAndSendTransaction({signerId:account,receiverId:contract,actions:[actionCreators.functionCall(action==='join'?'join':'act',args,30000000000000n,0n)]}));
  setMessage('Wallet request sent. Refresh finalized state after approval.');await refresh(contract,account);
 }catch(e){setMessage(e instanceof Error?e.message:'The wallet request failed. No local trade was recorded.');}finally{setBusy(false);}};
 const marketplace=async(method:'create_listing'|'buy_listing'|'cancel_listing',args:Record<string,unknown>)=>{if(!account||!data)return;setBusy(true);try{
  const selector=await selectorFor(contract),wallet=await selector.wallet(),{actionCreators}=await import('@near-wallet-selector/core');
  assertTransactionAccepted(await wallet.signAndSendTransaction({signerId:account,receiverId:contract,actions:[actionCreators.functionCall(method,args,30000000000000n,0n)]}));
  setMessage('Wallet request sent. Refresh finalized state after approval.');await refresh(contract,account);
 }catch(e){setMessage(e instanceof Error?e.message:'The marketplace request failed.');}finally{setBusy(false);}};
 const createListing=()=>{const q=Number(quantity),p=Number(price);if(!Number.isInteger(q)||q<1||q>100||!Number.isInteger(p)||p<1||p>1000){setMessage('Enter a quantity from 1–100 and a price from 1–1000.');return;}void marketplace('create_listing',{item,quantity:q,unit_price:p});};
 const reload=async()=>{if(!account)return;setBusy(true);try{await refresh(contract,account);}catch(e){setMessage(e instanceof Error?e.message:'Could not read testnet.');}finally{setBusy(false);}};
 return <section data-near-market><p className="obs-quiet">NEAR testnet · shared contract inventory and game coins; no real-value token. A testnet account, gas, and a deployed initialized contract are required.</p>
  <label>Contract account <input aria-label="NEAR testnet contract" value={contract} disabled={!!account||busy} placeholder="market.example.testnet" onChange={e=>{setContract(e.target.value.trim());setData(null);}} /></label>
  {!account?<button type="button" className="obs-row" data-nav disabled={busy} onClick={()=>void connect()}>Connect My NEAR Wallet</button>:<><p className="obs-quiet">Wallet: {account} · {contract}</p><button type="button" className="obs-row" data-nav disabled={busy} onClick={()=>void reload()}>Refresh finalized state</button><button type="button" className="obs-row" data-nav disabled={busy} onClick={()=>void(async()=>{try{const selector=await selectorFor(contract);await(await selector.wallet()).signOut();refreshGeneration.current++;setAccount('');setData(null);setMessage('Wallet disconnected.');}catch(e){setMessage(e instanceof Error?e.message:'Could not disconnect wallet.');}})()}>Disconnect</button></>}
  {account&&data&&!data.player&&<button type="button" className="obs-row" data-nav disabled={busy} onClick={()=>void call('join')}>Join the testnet market</button>}
  {account&&data?.player&&<><p className="obs-quiet">Day {data.town.day} · wallet {data.player.coins} coins · {data.player.timber} timber · {data.player.bread} bread · {data.player.energy} energy</p>
   <p className="obs-quiet">Commons {data.town.forest} · woodcutter’s stall {data.town.merchant_timber} / {data.town.merchant_coins} coins · baker’s stall {data.town.bakery_bread} / {data.town.bakery_coins} coins.</p>
   <p className="obs-quiet">Prices respond to stock and recent demand ({data.town.timber_demand} timber, {data.town.bread_demand} bread). A market day does not change the village clock; testnet days have a 60-second cooldown.</p>
   {([['gather','Gather 2 timber'],['sell-timber',`Sell timber · ${data.timber_bid}`],['buy-timber',`Buy timber · ${data.timber_ask}`],['buy-bread',`Buy bread · ${data.bread_ask}`],['sell-bread',`Sell bread · ${data.bread_bid}`],['bake','Bake 2 bread · 1 timber + 3 coins'],['eat','Eat bread'],['next-day','Next market day'],['donate-timber','Commit 12 timber to this village']] as const).map(([action,label])=><button key={action} type="button" data-nav className="obs-row" disabled={busy} onClick={()=>void call(action)}>{label}</button>)}
   <h4>Household wallets</h4><p className="obs-quiet">Last market day: {data.last_fed} households bought bread; {data.last_unfed} missed out. These are ledger events, not physical work animations.</p>
   <details><summary>View 25 household balances</summary><ul>{data.households.map((h,i)=><li key={EALDHOLT_VILLAGE_POPULATION.households[i].id}>{EALDHOLT_VILLAGE_POPULATION.households[i].label}: {h.coins} coins · {h.meals} rations bought · {h.missed} missed</li>)}</ul></details>
   <h4>Player marketplace</h4><p className="obs-quiet">Listed goods are held by the contract until sold or cancelled. Prices use game coins.</p>
   <label>Item <select value={item} disabled={busy} onChange={e=>setItem(e.target.value as 'timber'|'bread')}><option value="timber">Timber</option><option value="bread">Bread</option></select></label>
   <label>Quantity <input type="number" min="1" max="100" value={quantity} disabled={busy} onChange={e=>setQuantity(e.target.value)} /></label>
   <label>Coins per item <input type="number" min="1" max="1000" value={price} disabled={busy} onChange={e=>setPrice(e.target.value)} /></label>
   <button type="button" data-nav className="obs-row" disabled={busy} onClick={createListing}>List goods in escrow</button>
   {data.listings.length===0?<p className="obs-quiet">No listings yet.</p>:data.listings.map(l=><div key={l.id} className="obs-quiet"><p>#{l.id} · {l.seller}: {l.quantity} {l.item} at {l.unit_price} coins each</p>
    {l.seller===account?<button type="button" data-nav className="obs-row" disabled={busy} onClick={()=>void marketplace('cancel_listing',{listing_id:l.id})}>Cancel and reclaim goods</button>:<button type="button" data-nav className="obs-row" disabled={busy} onClick={()=>void marketplace('buy_listing',{listing_id:l.id,quantity:1,expected_unit_price:l.unit_price})}>Buy 1 · {l.unit_price} coins</button>}</div>)}
   {data.deliveries.filter(d=>d.world_hash===hash).map(d=>{const id=`${contract}:${account}:${d.id}`;const claimed=claims?.includes(id)??false;return <button key={id} type="button" data-nav className="obs-row" disabled={busy||!claims||claimed} onClick={()=>onClaim(id)}>{claimed?'Delivery applied':`Apply delivery #${d.id} to repair stores`}</button>;})}
  </>}
  <p role="status" className="obs-quiet">{message}</p>
 </section>;
}
