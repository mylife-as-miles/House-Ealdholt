/** Graphics boot readiness only. No clock, persistence, gameplay or source
 * mutation. Failed derivation retains its authored source fallback. Grass can
 * continue preparing after the first useful frame; distant trees need resident
 * captures before a full-source overview submits their original canopies.
 *
 * Environment programs are progressive replacements: their owner keeps each
 * current PBR binding until its replacement is compiled and published. Pending
 * colour, dormant-LOD or shadow programs describe preparation, not a missing
 * drawable. Waiting for them here can keep a complete village behind loading
 * while every scan admits another bounded cohort. */
export interface WoodlandPreparationState {readonly readyMask:number;readonly status:string}
export interface WoodlandMaterialPreparationState {readonly materialProgramsPending:number;readonly materialGraphPending:boolean}
export function initialWoodlandReadiness(generated:Iterable<WoodlandPreparationState|null>,
  authored:Iterable<WoodlandPreparationState&{readonly kind:string}>,regionalReady=true,
  materials?:WoodlandMaterialPreparationState|null):{readonly drawable:boolean;readonly prepared:boolean} {
  let drawable=regionalReady,prepared=regionalReady;
  const inspect=(state:WoodlandPreparationState,required:boolean)=>{
    const captured=state.readyMask===15;
    if(required&&!captured&&state.status!=='error')drawable=false;
    if(!captured||state.status!=='ready')prepared=false;
  };
  for(const state of generated)if(state)inspect(state,true);
  for(const state of authored)inspect(state,state.kind==='tree');
  if(materials&&(materials.materialProgramsPending!==0||materials.materialGraphPending))prepared=false;
  return {drawable,prepared};
}
/** Compatibility predicate for callers that only need the safe first draw. */
export function initialWoodlandReady(generated:Iterable<WoodlandPreparationState|null>,
  authored:Iterable<WoodlandPreparationState&{readonly kind:string}>,regionalReady=true):boolean {
  return initialWoodlandReadiness(generated,authored,regionalReady).drawable;
}
/** The share, 0 to 1, of that same preparation that is complete: each woodland
 * counts the four bits of its ready mask (a failed one counts as done, since it
 * keeps its authored fallback) and the regional forest counts as one more.
 * Presentation only, for a loading bar; initialWoodlandReady remains the gate. */
export function initialWoodlandProgress(generated:Iterable<WoodlandPreparationState|null>,
  authored:Iterable<WoodlandPreparationState&{readonly kind:string}>,regionalReady=true):number {
  let done=regionalReady?1:0,total=1;
  const count=(s:WoodlandPreparationState)=>{total++;
    if(s.status==='error'){done++;return;}
    for(let bit=0;bit<4;bit++)if(s.readyMask&1<<bit)done+=.25;};
  for(const state of generated)if(state)count(state);
  for(const state of authored)if(state.kind==='tree')count(state);
  return done/total;
}
