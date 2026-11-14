import {createRegionalProjectedGround} from '../../../../shared/legacy/aethelgard/environment/regional-projected-ground';
import {createRegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import {createEaldholtRegionalHorizon} from '../../../../shared/legacy/aethelgard/environment/regional-horizon';
self.onmessage=(event:MessageEvent<Parameters<typeof createRegionalWorldLayout>[0]&{profile:'desktop'|'quest';projected?:boolean}>)=>{
 try{const input=event.data,horizon=createEaldholtRegionalHorizon(input.geography,input.profile);
 const layout=createRegionalWorldLayout({...input,land:[...input.land,...(input.projected?[createRegionalProjectedGround(input.geography)]:[]),{positions:horizon.positions,indices:horizon.indices}]});
 (self as unknown as {postMessage(message:unknown,transfer:Transferable[]):void}).postMessage({layout,horizon:{positions:horizon.positions,indices:horizon.indices,bounds:horizon.bounds}},[horizon.positions.buffer as ArrayBuffer,horizon.indices.buffer as ArrayBuffer,layout.placements.buffer as ArrayBuffer,layout.rocks.buffer as ArrayBuffer,...layout.cells.map(c=>c.ids.buffer as ArrayBuffer)]);
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
