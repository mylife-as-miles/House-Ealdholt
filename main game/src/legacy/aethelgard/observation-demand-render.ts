/** Hold automatic Reduced Motion repaints while a large real forecast catches
 * up. Explicit input/asset dirtiness still belongs to the existing renderer. */
export function createObservationDemandRender(){
 let holding=false;
 return{
  get holding(){return holding;},
  /** True exactly once when a previously held forecast really drains. */
  update(enabled:boolean,pendingMilliseconds:number,millisecondsPerWorldMinute:number):boolean{
   if(!enabled){holding=false;return false;}
   if(!Number.isFinite(pendingMilliseconds)||pendingMilliseconds<0||!Number.isFinite(millisecondsPerWorldMinute)||millisecondsPerWorldMinute<=0)return false;
   if(holding&&pendingMilliseconds===0){holding=false;return true;}
   if(pendingMilliseconds>2*millisecondsPerWorldMinute)holding=true;
   return false;
  },
  allowAutomatic(){return !holding;},
  allowCompletionPollDraw(explicitlyDirty:boolean){return !holding||explicitlyDirty;},
  cancel(){holding=false;},
 };
}
