interface PreparationQueue {
 readonly pending:boolean;
 readonly running:boolean;
 step():void;
}
/** One bounded operation per cadence, independent of compositor RAF. Reads no
 * world clock/simulation state. Owners provide GPU-frame and active/view gates;
 * Native immersive preparation retains its existing frame ownership. */
export function createWorldPreparationPump(options:{queue:PreparationQueue;allowed():boolean;gpuReady():boolean;changed?():void;intervalMilliseconds?:number;now?():number}){
 const interval=options.intervalMilliseconds??1000/60,now=options.now??(()=>performance.now());
 if(!Number.isFinite(interval)||interval<4||interval>1000)throw Error('Invalid world preparation cadence.');
 let timer:ReturnType<typeof setTimeout>|null=null,disposed=false,nextAt=-Infinity;
 const stats={tasks:0,steps:0,gpuWaits:0,timerPending:false};
 function cancel(){const scheduled=timer!==null;if(scheduled)clearTimeout(timer!);timer=null;stats.timerPending=false;if(scheduled)options.changed?.();}
 function wake(){
  if(disposed||timer!==null||!options.queue.pending||options.queue.running||!options.allowed())return;
  stats.timerPending=true;timer=setTimeout(()=>{timer=null;stats.tasks++;stats.timerPending=false;step();options.changed?.();},Math.ceil(Math.max(0,nextAt-now())));options.changed?.();
 }
 function step():boolean{
  if(disposed||!options.queue.pending||options.queue.running||!options.allowed()){cancel();return false;}
  const time=now();if(time<nextAt){wake();return false;}
  cancel();nextAt=time+interval;
  if(!options.gpuReady()){stats.gpuWaits++;wake();options.changed?.();return false;}
  options.queue.step();stats.steps++;options.changed?.();
  // enqueue/finally wake continuation. In-flight promises and empty/error
  // queues never create a timer polling loop here.
  return true;
 }
 return{stats,wake,step,pause:cancel,dispose(){if(disposed)return;disposed=true;cancel();}};
}
