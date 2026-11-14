import type {WorldGpuFrameIdentity,WorldGpuFrameTerminal} from './world-gpu-frame';
export interface WorldGlCompletion extends WorldGpuFrameIdentity {
 readonly status:'clean'|'error'|'failed'|'unsupported';readonly errors:readonly number[];readonly reason:string|null;
}
/** Diagnostics never read the error queue until the owning fence completes.
 * The last completion is retained separately from the next pending frame. */
export function createWorldGlDiagnostics(gl:Pick<WebGLRenderingContext,'getError'|'NO_ERROR'|'isContextLost'>){
 let pending:WorldGpuFrameIdentity|null=null,completed:WorldGlCompletion|null=null;
 const errors:number[]=[];
 const publish=(frame:WorldGpuFrameIdentity,status:WorldGlCompletion['status'],reason:string|null,observed:readonly number[]=[])=>{
  completed=Object.freeze({...frame,status,reason,errors:Object.freeze([...observed])});pending=null;
 };
 return{
  get report(){return Object.freeze({version:'completed-world-frame-gl-errors-v1',pending,completed,errors:Object.freeze([...errors])});},
  submitted(frame:WorldGpuFrameIdentity){pending=Object.freeze({...frame});},
  failed(frame:WorldGpuFrameIdentity,reason:string){publish(frame,'failed',reason);},
  terminal(event:WorldGpuFrameTerminal){
   if(!pending||pending.canvasFrame!==event.frame.canvasFrame||pending.rendererFrame!==event.frame.rendererFrame){publish(event.frame,'failed','unmatched-submission');return;}
   if(event.status!=='complete'){publish(event.frame,event.status,event.reason);return;}
   try{
    if(gl.isContextLost()){publish(event.frame,'failed','context-lost');return;}
    const observed:number[]=[];let exhausted=true;
    for(let i=0;i<8;i++){const code=gl.getError();if(code===gl.NO_ERROR){exhausted=false;break;}observed.push(code);if(errors.length<8)errors.push(code);}
    publish(event.frame,observed.length||errors.length||exhausted?'error':'clean',exhausted?'error-queue-not-drained':null,observed);
   }catch{publish(event.frame,'failed','error-queue-unavailable');}
  },
 };
}
