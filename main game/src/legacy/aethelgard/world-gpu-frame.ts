export interface WorldGpuFrameIdentity { readonly canvasFrame: number; readonly rendererFrame: number }
export interface WorldGpuFrameTerminal { readonly frame: WorldGpuFrameIdentity; readonly status: 'complete' | 'failed' | 'unsupported'; readonly reason: string | null }
/** Coalesce event-driven world redraws instead of filling the driver's queue
 * with heavy duplicate frames while assets become ready. Zero-timeout fence
 * polling yields to input; this never waits synchronously for the GPU. */
export function createWorldGpuFrameGate(context: WebGLRenderingContext | WebGL2RenderingContext,
 options: {onTerminal?(event:WorldGpuFrameTerminal):void;pollMilliseconds?:number} = {}) {
  const gl = 'fenceSync' in context ? context : null;
  const cadence=options.pollMilliseconds??16;
  if(!Number.isFinite(cadence)||cadence<4||cadence>1000)throw Error('Invalid GPU completion poll cadence.');
  let fence: WebGLSync | null = null, disposed = false, failed=false;
  let pendingFrame:WorldGpuFrameIdentity|null=null,timer:ReturnType<typeof setTimeout>|null=null,ticket=0;
  const stats = {pending: false, submitted: 0, completed: 0, deferred: 0, failures: 0, preparationPolls: 0};
  function cancelPoll(){ticket++;if(timer!==null)clearTimeout(timer);timer=null;}
  function terminal(status:WorldGpuFrameTerminal['status'],reason:string|null){
   cancelPoll();const frame=pendingFrame;pendingFrame=null;stats.pending=false;
   if(!frame)return;
   try{options.onTerminal?.({frame,status,reason});}catch{failed=true;stats.failures++;}
  }
  function queuePoll(){
   if(!options.onTerminal||disposed||failed||!fence||timer!==null)return;
   const expected=ticket;timer=setTimeout(()=>{timer=null;if(disposed||expected!==ticket)return;gate.ready();queuePoll();},cadence);
   (timer as unknown as {unref?:()=>void}).unref?.();
  }
  const gate = {
    stats,
    get terminalFailure(){return failed;},
    // Preparation must restore renderer state before yielding. Its uploads,
    // compilation and asynchronous atlas readbacks are ordered after the world
    // commands on the same context; none submits a second world frame.
    ready(whileWaiting?:()=>void) {
      if (disposed||failed) return false;
      if (!gl || !fence) return true;
      let status:number;
      try{status=gl.isContextLost?.()?gl.WAIT_FAILED:gl.clientWaitSync(fence, 0, 0);}catch{status=gl.WAIT_FAILED;}
      if (status === gl.TIMEOUT_EXPIRED) {stats.deferred++;if(whileWaiting){stats.preparationPolls++;whileWaiting();}return false;}
      gl.deleteSync(fence); fence = null; stats.pending = false;
      if(status!==gl.ALREADY_SIGNALED&&status!==gl.CONDITION_SATISFIED){failed=true;stats.failures++;terminal('failed',status===gl.WAIT_FAILED?'fence-wait-failed':'unknown-fence-status');return false;}
      stats.completed++;
      // Every poller drains terminal diagnostics before it can perform more
      // shared-context preparation or submit another world frame.
      terminal('complete',null);
      return !failed;
    },
    submitted(identity?:WorldGpuFrameIdentity) {
      if (disposed) return;
      if(failed)throw Error('World GPU completion is unavailable.');
      if (fence) throw Error('A world frame is already in flight.');
      const frame=identity??{canvasFrame:stats.submitted+1,rendererFrame:stats.submitted+1};
      if(![frame.canvasFrame,frame.rendererFrame].every(v=>Number.isSafeInteger(v)&&v>0))throw Error('Invalid submitted world frame identity.');
      pendingFrame=Object.freeze({...frame});
      if (!gl) {stats.failures++;terminal('unsupported','gpu-fence-unavailable');return;}
      try {
        fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); stats.submitted++;
        stats.pending = fence !== null;
        if (!fence) {failed=true;stats.failures++;terminal('failed','gpu-fence-null');return;}
        gl.flush();queuePoll();
      } catch {
        if(fence)gl.deleteSync(fence);fence=null;failed=true;stats.failures++;terminal('failed','gpu-submission-unavailable');
      }
    },
    dispose() {if (disposed) return; disposed = true;cancelPoll(); if (fence && gl) gl.deleteSync(fence); fence = null;stats.pending=false;terminal('failed','disposed-before-completion');},
  };
  return gate;
}
