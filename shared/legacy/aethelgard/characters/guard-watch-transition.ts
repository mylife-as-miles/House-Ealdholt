/** Only the exact adjacent phase domains measured by the addon may crossfade.
 * Cold, late, skipped or interrupted stages cut to their actual authored pose;
 * they never blend an unseen setup idle or claim the skipped performance. */
export function guardWatchTransitionFade(from:string,fromTime:number|null,to:string,toTime:number|undefined,
  alreadyFading:boolean,positioned:boolean,seconds:number,fade:number):number{
 if(!positioned||alreadyFading||toTime===undefined||!Number.isFinite(toTime)||Math.abs(toTime)>1e-7
   ||fromTime===null||!Number.isFinite(fromTime)||fromTime<0)return 0;
 const pair=from+'>'+to;
 if(pair==='walk>workEnter'||pair==='work>workExit')return fade;
 if((pair==='workEnter>work'||pair==='workExit>walk')&&Math.abs(fromTime-(seconds-fade))<=1e-7)return fade;
 return 0;
}
