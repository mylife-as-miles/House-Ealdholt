import {createEaldholtRegionalWoodlandLayout} from '../../../../shared/legacy/aethelgard/environment/far-woodland';
import {createEaldholtProjectedWoodlandSupport} from '../../../../shared/legacy/aethelgard/environment/regional-woodland-support';
type Input=Parameters<typeof createEaldholtRegionalWoodlandLayout>[0]&{projected?:boolean};
self.onmessage=(event:MessageEvent<Input>)=>{
  try{const input=event.data;self.postMessage({layout:createEaldholtRegionalWoodlandLayout({...input,...(input.projected?createEaldholtProjectedWoodlandSupport(input.geography):{})})});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
