import {useCallback,useEffect,useRef,useState} from 'react';
import type {WalletSelector,InjectedWallet} from '@near-wallet-selector/core';
import type {MarketAction} from '../../../../../shared/legacy/aethelgard/observer/market-economy';

import {validTestnetContract,readNearMarket,hashWorld,type NearSnapshot} from './near-market-client';
const CONTRACT_KEY='house-ealdholt.near-testnet-contract';
let selectorPromise:Promise<WalletSelector>|null=null;let selectorContract='';
async function selectorFor(contract:string){
 if(selectorContract!==contract){selectorPromise=null;selectorContract=contract;}
 return selectorPromise??=(async()=>{const [{setupWalletSelector},{setupMyNearWallet}]=await Promise.all([import('@near-wallet-selector/core'),import('@near-wallet-selector/my-near-wallet')]);return setupWalletSelector({network:'testnet',modules:[setupMyNearWallet()],createAccessKeyFor:{contractId:contract,methodNames:['join','act']}});})();
}
export function NearMarket({worldKey,claims,onClaim}:{worldKey:string;claims:readonly string[]|null;onClaim(id:string):void}){
 const [contract,setContract]=useState(()=>{try{return localStorage.getItem(CONTRACT_KEY)??'';}catch{return '';}});
 const [account,setAccount]=useState(''),[data,setData]=useState<NearSnapshot|null>(null),[hash,setHash]=useState('');
 const refreshGeneration=useRef(0);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('Testnet is separate from the local market. Connect your own wallet and deployed contract.');
 useEffect(()=>{let live=true;void hashWorld(worldKey).then(v=>{if(live)setHash(v)}).catch(()=>{if(live)setMessage('Secure context required for the village identifier.');});return()=>{live=false;};},[worldKey]);
 const refresh=useCallback(async(id:string,who:string)=>{const generation=++refreshGeneration.current;const next=await readNearMarket(id,who);if(generation!==refreshGeneration.current)return;setData(next);setMessage('Showing finalized NEAR testnet state. Transactions require your wallet approval.');},[]);
 useEffect(()=>{if(!validTestnetContract(contract))return;let live=true;void(async()=>{try{const selector=await selectorFor(contract);if(!selector.isSignedIn())return;const wallet=await selector.wallet();const [first]=await wallet.getAccounts();if(live&&first){setAccount(first.accountId);await refresh(contract,first.accountId);}}catch(e){if(live)setMessage(e instanceof Error?e.message:'Could not restore wallet.');}})();return()=>{live=false;refreshGeneration.current++;};},[contract,refresh]);
 const connect=async()=>{if(!validTestnetContract(contract)){setMessage('Enter a valid contract account ending in .testnet.');return;}setBusy(true);try{localStorage.setItem(CONTRACT_KEY,contract);const selector=await selectorFor(contract),wallet=await selector.wallet<InjectedWallet>('my-near-wallet');const accounts=await wallet.signIn({contractId:contract,methodNames:['join','act']});if(accounts?.[0]){setAccount(accounts[0].accountId);await refresh(contract,accounts[0].accountId);}else setMessage('Continue in your wallet; return here afterward.');}catch(e){setMessage(e instanceof Error?e.message:'Wallet connection failed.');}finally{setBusy(false);}};
 const call=async(action:MarketAction|'join')=>{if(!account||!data||!hash)return;setBusy(true);try{const selector=await selectorFor(contract),wallet=await selector.wallet(),{actionCreators}=await import('@near-wallet-selector/core');
  const limit=action==='sell-timber'?data.timber_bid:action==='buy-timber'?data.timber_ask:action==='buy-bread'?data.bread_ask:0;
  const args=action==='join'?{}:{action,limit,world_hash:action==='donate-timber'?hash:null};
  await wallet.signAndSendTransaction({signerId:account,receiverId:contract,actions:[actionCreators.functionCall(action==='join'?'join':'act',args,30000000000000n,0n)]});
  setMessage('Wallet request sent. Refresh finalized state after approval.');await refresh(contract,account);
 }catch(e){setMessage(e instanceof Error?e.message:'The wallet request failed. No local trade was recorded.');}finally{setBusy(false);}};
 const reload=async()=>{if(!account)return;setBusy(true);try{await refresh(contract,account);}catch(e){setMessage(e instanceof Error?e.message:'Could not read testnet.');}finally{setBusy(false);}};
 return <section data-near-market><p className="obs-quiet">NEAR testnet · shared contract inventory and game coins; no real-value token. A testnet account, gas, and a deployed initialized contract are required.</p>
  <label>Contract account <input aria-label="NEAR testnet contract" value={contract} disabled={!!account||busy} placeholder="market.example.testnet" onChange={e=>{setContract(e.target.value.trim());setData(null);}} /></label>
  {!account?<button type="button" className="obs-row" data-nav disabled={busy} onClick={()=>void connect()}>Connect My NEAR Wallet</button>:<><p className="obs-quiet">Wallet: {account} · {contract}</p><button type="button" className="obs-row" data-nav disabled={busy} onClick={()=>void reload()}>Refresh finalized state</button><button type="button" className="obs-row" data-nav disabled={busy} onClick={()=>void(async()=>{try{const selector=await selectorFor(contract);await(await selector.wallet()).signOut();refreshGeneration.current++;setAccount('');setData(null);setMessage('Wallet disconnected.');}catch(e){setMessage(e instanceof Error?e.message:'Could not disconnect wallet.');}})()}>Disconnect</button></>}
  {account&&data&&!data.player&&<button type="button" className="obs-row" data-nav disabled={busy} onClick={()=>void call('join')}>Join the testnet market</button>}
  {account&&data?.player&&<><p className="obs-quiet">Day {data.town.day} · wallet {data.player.coins} coins · {data.player.timber} timber · {data.player.bread} bread · {data.player.energy} energy</p>
   <p className="obs-quiet">Commons {data.town.forest} · woodcutter’s stall {data.town.merchant_timber} / {data.town.merchant_coins} coins · baker’s stall {data.town.bakery_bread} / {data.town.bakery_coins} coins.</p>
   <p className="obs-quiet">Prices respond to stock and recent demand ({data.town.timber_demand} timber, {data.town.bread_demand} bread). A market day does not change the village clock.</p>
   {([['gather','Gather 2 timber'],['sell-timber',`Sell timber · ${data.timber_bid}`],['buy-timber',`Buy timber · ${data.timber_ask}`],['buy-bread',`Buy bread · ${data.bread_ask}`],['eat','Eat bread'],['next-day','Next market day'],['donate-timber','Commit 12 timber to this village']] as const).map(([action,label])=><button key={action} type="button" data-nav className="obs-row" disabled={busy} onClick={()=>void call(action)}>{label}</button>)}
   {data.deliveries.filter(d=>d.world_hash===hash).map(d=>{const id=`${contract}:${account}:${d.id}`;const claimed=claims?.includes(id)??false;return <button key={id} type="button" data-nav className="obs-row" disabled={busy||!claims||claimed} onClick={()=>onClaim(id)}>{claimed?'Delivery applied':`Apply delivery #${d.id} to repair stores`}</button>;})}
  </>}
  <p role="status" className="obs-quiet">{message}</p>
 </section>;
}
