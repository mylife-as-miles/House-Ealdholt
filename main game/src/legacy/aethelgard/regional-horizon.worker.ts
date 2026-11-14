import {createEaldholtRegionalHorizon} from '../../../../shared/legacy/aethelgard/environment/regional-horizon';
import type {EaldholtFarGeography} from '../../../../shared/legacy/aethelgard/environment/far-surround';
self.onmessage=(event:MessageEvent<{geography:EaldholtFarGeography;profile:'desktop'|'quest'}>)=>{
  try{
    const data=createEaldholtRegionalHorizon(event.data.geography,event.data.profile);
    self.postMessage({data}, {transfer:[data.positions.buffer,data.normals.buffer,data.colours.buffer,data.uv.buffer,data.indices.buffer]});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
