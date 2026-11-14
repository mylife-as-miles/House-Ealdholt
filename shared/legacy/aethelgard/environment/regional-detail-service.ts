/** A static view still needs one follow-up after a throttled detail update.
 * This schedules the owner's normal redraw, never a render or simulation tick. */
export const REGIONAL_DETAIL_SERVICE_MILLISECONDS=180;
export interface RegionalDetailServiceTimers {
 now():number;
 set(callback:()=>void,delay:number):unknown;
 clear(handle:unknown):void;
}
export function createRegionalDetailService(wake:()=>void,timers:RegionalDetailServiceTimers={
 now:()=>performance.now(),set:(callback,delay)=>setTimeout(callback,delay),
 clear:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>),
}){
 let handle:unknown=null,deadline=Infinity,generation=0,suspended=false,disposed=false;
 function cancel(){generation++;if(handle!==null)timers.clear(handle);handle=null;deadline=Infinity;}
 return{
  get pending(){return handle!==null;},
  schedule(at:number){
   if(disposed||suspended)return;
   if(!Number.isFinite(at))throw Error('Regional detail service requires a finite deadline.');
   const due=Math.max(timers.now(),at);if(handle!==null&&deadline<=due)return;
   cancel();deadline=due;const current=generation;
   handle=timers.set(()=>{if(disposed||suspended||current!==generation)return;handle=null;deadline=Infinity;wake();},Math.max(0,due-timers.now()));
  },
  cancel,
  suspend(){if(disposed)return;suspended=true;cancel();},
  resume(){if(disposed||!suspended)return;suspended=false;wake();},
  dispose(){if(disposed)return;disposed=true;cancel();},
 };
}

/** Failed source derivatives retain L0, but must not occupy a preparation slot
 * forever or make the delayed service poll a terminal error. */
export function regionalDetailCellProgress(levels:readonly {readonly stats:{readonly readyMask:number;readonly status:string;readonly error?:string}}[]){
 let ready=levels.length>0,preparing=false,error='';
 for(const {stats}of levels){if(stats.readyMask!==15||stats.status==='error')ready=false;if(stats.readyMask!==15&&stats.status!=='error')preparing=true;
  if(stats.status==='error'&&!error)error=(stats.error||'Source detail preparation failed.').slice(0,320);}
 const held=!ready&&!preparing;if(held&&!error)error='Source detail has no complete derivative.';
 return{ready,preparing,held,error};
}
