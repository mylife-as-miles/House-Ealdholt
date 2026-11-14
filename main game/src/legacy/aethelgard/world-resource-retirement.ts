import type {WebGLRenderer} from 'three';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {assertWorldOwnerQuiescence,type WorldOwnerQuiescence} from '../../../../shared/legacy/aethelgard/environment/world-owner-retirement';

/** Remove draws first, then fence commands already submitted by the live world
 * and preparation queue. Zero-timeout polling yields to rendering and input.
 * A lost context has already released its GPU objects. A transient failed/null
 * sync retains resources and retries instead of claiming they are safe. */
export function createWorldResourceRetirementFence(renderer:WebGLRenderer,queue:WorldPreparationQueue){
 const stats={pending:0,completed:0,retries:0,waitingForQueue:0,waitingForGPU:0,ownerScoped:0};
 const wait=async(global:boolean)=>{
  stats.pending++;
  try{
  if(global){stats.waitingForQueue++;try{await queue.whenIdle();}finally{stats.waitingForQueue--;}}
  const context=renderer.getContext();
  if(!('fenceSync'in context)||context.isContextLost()){stats.completed++;return;}
  const gl=context;let fence:WebGLSync|null=null;
  stats.waitingForGPU++;
  try{
  await new Promise<void>(resolve=>{
   const poll=()=>{
    if(gl.isContextLost()){if(fence)gl.deleteSync(fence);resolve();return;}
    if(!fence){fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();}
    if(fence){const status=gl.clientWaitSync(fence,0,0);if(status!==gl.TIMEOUT_EXPIRED&&status!==gl.WAIT_FAILED){gl.deleteSync(fence);resolve();return;}
     if(status===gl.WAIT_FAILED){stats.retries++;gl.deleteSync(fence);fence=null;}}
    else stats.retries++;
    setTimeout(poll,16);
   };poll();
  });stats.completed++;
  }finally{stats.waitingForGPU--;}
  }finally{stats.pending--;}
 };
 // Ordinary view/borrowed-source callers keep the global queue barrier. Only
 // the ordered owner helper can issue a token for already-quiescent work.
 return Object.assign(()=>wait(true),{stats,afterOwnerQuiescent(owner:WorldOwnerQuiescence){
  assertWorldOwnerQuiescence(owner);stats.ownerScoped++;return wait(false);
 }});
}
