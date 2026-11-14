/** Applied NEAR testnet delivery IDs share the observer save transaction with repair stock. */
export type NearClaimsRestore={readonly status:'valid';readonly ids:readonly string[]}|{readonly status:'invalid';readonly raw:unknown};
export function restoreNearClaims(raw:unknown):NearClaimsRestore {
  if(!Array.isArray(raw)||raw.length>1024||raw.some(id=>typeof id!=='string'||id.length<3||id.length>180||!/^[a-z0-9._:-]+$/.test(id))||new Set(raw).size!==raw.length)return {status:'invalid',raw};
  return {status:'valid',ids:[...raw]};
}
export function addNearClaim(current:NearClaimsRestore|undefined,id:string):NearClaimsRestore {
  if(current?.status==='invalid')throw Error('Saved testnet delivery claims are invalid and preserved.');
  const ids=current?.ids??[];if(ids.includes(id))throw Error('This delivery was already applied.');
  const result=restoreNearClaims([...ids,id]);if(result.status==='invalid')throw Error('Invalid testnet delivery identity.');return result;
}
