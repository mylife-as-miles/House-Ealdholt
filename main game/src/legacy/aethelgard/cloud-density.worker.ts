import {createCloudDensityVolume} from '../../../../shared/legacy/aethelgard/environment/cloud-volume';
self.onmessage=async(event:MessageEvent<{width:number;height:number}>)=>{
 const {width,height}=event.data;let backend='cpu-worker',fallbackReason='WebGPU unavailable',data:Uint8Array|undefined,debugStack='';
 try{
  if((navigator as Navigator&{gpu?:unknown}).gpu&&typeof OffscreenCanvas!=='undefined'){
   try{data=await(await import('./cloud-density-gpu')).bakeCloudDensityOnGpu(width,height);backend='webgpu-tsl';fallbackReason='';}
   catch(cause){fallbackReason=cause instanceof Error?cause.message:String(cause);if(import.meta.env.DEV&&cause instanceof Error)debugStack=cause.stack??'';}
  }
  data??=createCloudDensityVolume(width,height);
  (self as unknown as {postMessage(message:unknown,transfer:Transferable[]):void}).postMessage({data,backend,fallbackReason,debugStack},[data.buffer as ArrayBuffer]);
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
