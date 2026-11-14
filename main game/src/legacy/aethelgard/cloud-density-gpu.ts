/// <reference types="@webgpu/types" />
/** Optional one-shot TSL compute bake. Only typed density bytes cross back to
 * the existing renderer; this worker never imports or replaces the game scene. */
import {WebGPURenderer} from 'three/webgpu';
import {Fn,float,instanceIndex,instancedArray,uint,vec2,vec3,wgslFn} from 'three/tsl';
import {cloudDensityByteLength,finalizeCloudOccurrence,validateCloudDensityVolume} from '../../../../shared/legacy/aethelgard/environment/cloud-volume';
import source from '../../../../shared/legacy/aethelgard/environment/cloud-density.wgsl?raw';
export async function bakeCloudDensityOnGpu(width:number,height:number){
 cloudDensityByteLength(width,height); // Reject unbounded work before requesting a GPU or allocating storage.
 const gpu=(navigator as Navigator&{gpu?:{requestAdapter():Promise<{requestDevice():Promise<GPUDevice>}|null>}}).gpu;
 const adapter=await gpu?.requestAdapter();if(!adapter)throw Error('WebGPU adapter unavailable; use CPU worker.');
 const device=await adapter.requestDevice(),canvas=new OffscreenCanvas(1,1),renderer=new WebGPURenderer({canvas,device,antialias:false});
 try{
  await renderer.init();if(!('isWebGPUBackend' in renderer.backend)||renderer.backend.isWebGPUBackend!==true)throw Error('WebGPU adapter unavailable; use CPU worker.');
  const count=width*height*width,output=instancedArray(count,'uint'),shape=wgslFn(source.replace(/^\s*\/\/.*$/gm,'').trim());
  const compute=Fn(()=>{
   const x=float(instanceIndex.mod(uint(width))).add(.5).div(width),y=float(instanceIndex.div(uint(width)).mod(uint(height))).add(.5).div(height),z=float(instanceIndex.div(uint(width*height))).add(.5).div(width);
   // wgslFn typings erase its return type; the source signature is vec2f.
   const field=vec2(shape({p:vec3(x,y,z)}) as ReturnType<typeof vec2>).mul(255).round().clamp(0,255);
   output.element(instanceIndex).assign(uint(field.x).add(uint(field.y).mul(256)));
  })().compute(count);
  await renderer.computeAsync(compute);const buffer=await renderer.getArrayBufferAsync(output.value);
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==count*4)throw Error('Invalid GPU density readback.');
  const values=new Uint32Array(buffer);if(values.some(n=>n>65535))throw Error('Invalid GPU RG8 cloud density values.');
  const data=new Uint8Array(count*2);for(let i=0;i<count;i++){data[i*2]=values[i]&255;data[i*2+1]=values[i]>>>8;}
  finalizeCloudOccurrence(data,width,height);if(!validateCloudDensityVolume(data,width,height))throw Error('GPU cloud source validation failed.');
  compute.dispose();return data;
 }finally{renderer.dispose();device.destroy();}
}
