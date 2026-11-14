/** Presentation selection over already source-qualified IDs only. No placement,
 * water/path/collision qualification, new IDs or rendering budgets are owned here. */
export const NATURAL_RIPARIAN_COVERAGE_VERSION='source-qualified-bank-coverage-v1';
export interface NaturalRiparianCandidate{id:number;family:number;distance:number;cellX:number;cellZ:number}
/** Reused bounded storage: half the slots favor nearby distinct6m source cells;
 * the rest retain nearest detail. Original random centres/yaws never move. */
export function createNaturalRiparianCoverage(limit:number){
 if(!Number.isSafeInteger(limit)||limit<1||limit>24)throw Error('Invalid bounded natural bank coverage limit.');
 const row=():NaturalRiparianCandidate=>({id:-1,family:0,distance:Infinity,cellX:0,cellZ:0});
 const closest=Array.from({length:limit},row),spread=Array.from({length:limit},row),selected=Array.from({length:limit},row);
 let closeCount=0,spreadCount=0,count=0;
 const copy=(to:NaturalRiparianCandidate,from:NaturalRiparianCandidate)=>{to.id=from.id;to.family=from.family;to.distance=from.distance;to.cellX=from.cellX;to.cellZ=from.cellZ;};
 const before=(distance:number,id:number,other:NaturalRiparianCandidate)=>distance<other.distance||distance===other.distance&&id<other.id;
 function insert(rows:NaturalRiparianCandidate[],length:number,id:number,family:number,distance:number,cellX:number,cellZ:number){
  let at=0;while(at<length&&!before(distance,id,rows[at]))at++;if(at>=limit)return length;
  for(let i=Math.min(length,limit-1);i>at;i--)copy(rows[i],rows[i-1]);
  const target=rows[at];target.id=id;target.family=family;target.distance=distance;target.cellX=cellX;target.cellZ=cellZ;return Math.min(limit,length+1);
 }
 return{rows:selected,reset(){closeCount=spreadCount=count=0;},consider(id:number,family:number,distance:number,x:number,z:number){
  if(!Number.isSafeInteger(id)||id<0||id>=8192||!Number.isSafeInteger(family)||family<0||family>254||!Number.isFinite(distance)||distance<0||!Number.isFinite(x)||!Number.isFinite(z))throw Error('Invalid source-qualified bank candidate.');
  const cellX=Math.floor(x/6),cellZ=Math.floor(z/6);
  // Valid layout cohorts are unique; ignore duplicate submissions defensively.
  for(let i=0;i<closeCount;i++)if(closest[i].id===id)return;
  closeCount=insert(closest,closeCount,id,family,distance,cellX,cellZ);
  let existing=-1;for(let i=0;i<spreadCount;i++)if(spread[i].cellX===cellX&&spread[i].cellZ===cellZ){existing=i;break;}
  if(existing>=0){if(!before(distance,id,spread[existing]))return;for(let i=existing;i<spreadCount-1;i++)copy(spread[i],spread[i+1]);spreadCount--;}
  spreadCount=insert(spread,spreadCount,id,family,distance,cellX,cellZ);
 },finish(){
  count=0;for(let i=0;i<Math.min(spreadCount,Math.ceil(limit/2));i++)copy(selected[count++],spread[i]);
  for(let i=0;i<closeCount&&count<limit;i++){let duplicate=false;for(let j=0;j<count;j++)if(selected[j].id===closest[i].id){duplicate=true;break;}if(!duplicate)copy(selected[count++],closest[i]);}
  return count;
 }};
}
