import {FOREST01_DENSITY_LOD} from '../../../../shared/legacy/aethelgard/environment/forest01-density-lod';
import {Group,type Camera} from 'three';
import {createRealisticRegionalTrees,realisticTreeMemoryBudget} from './realistic-regional-trees';
import {REALISTIC_FOREST01_FAMILY,REALISTIC_TREE_FAMILY,type NormalizedRealisticTreeSource} from './realistic-tree-source';
import {createVegetationPrototypeResources,type VegetationPersistentIdentity,type VegetationPrototypeResources} from './vegetation-prototype';
import type {VegetationCapturePart} from './vegetation-atlas-capture';
import {createWorldResourceRetirementFence} from './world-resource-retirement';
import {createRealisticTreeBudget,realisticTreeDetailPlan} from '../../../../shared/legacy/aethelgard/environment/realistic-tree-budget';
import {REALISTIC_TREE_COHORT_VERSION,REALISTIC_TREE_COHORT_LIMIT} from '../../../../shared/legacy/aethelgard/environment/realistic-tree-cohort';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';

type Options=Parameters<typeof createRealisticRegionalTrees>[0]&{forest01Source?:NormalizedRealisticTreeSource|null};

/** A shared pool may evict an unused resource while its former family has a
 * submitted frame or asynchronous compiler. Delay each scope's final release
 * until preparation settles and the world/queue GPU fence has retired it.
 * Only explicitly unsubmitted rejected geometry can release immediately. */
export function scopeRealisticTreeResources(base:VegetationPrototypeResources,fence:()=>Promise<void>){
 const pending=new Set<Promise<void>>();let finish!:()=>void;const disposed=new Promise<void>(resolve=>{finish=resolve;});let closed=false;
 const wrap=<T extends {ready:Promise<unknown>;release():void;releaseUnsubmitted?:()=>void}>(lease:T):T=>{let released=false;
  const wrapped={...lease,release(){if(released)return;released=true;
   const job=lease.ready.catch(()=>{}).then(()=>fence()).then(()=>lease.release()).finally(()=>pending.delete(job));pending.add(job);
  }};
  if(lease.releaseUnsubmitted)Object.assign(wrapped,{releaseUnsubmitted(){if(released)return;released=true;lease.releaseUnsubmitted!();}});
  return wrapped;
 };
 const resources:VegetationPrototypeResources={...base,
  ownerBuffers:(...args)=>wrap(base.ownerBuffers(...args)),material:(...args)=>wrap(base.material(...args)),geometry:(...args)=>wrap(base.geometry(...args)),indices:(...args)=>wrap(base.indices(...args)),atlas:(...args)=>wrap(base.atlas(...args)),compile:(...args)=>wrap(base.compile(...args)),
  dispose(){if(closed)return;closed=true;void Promise.all(pending).then(finish);},
 };
 return{resources,disposed};
}

/** Two source-specific presentations, one original authored-source budget.
 * Forest01 keeps one heavy detail slot and two PP3s. One guarded L1-only
 * actor may join after primary readiness under112,766 charged triangles. Pending and retiring models remain charged. Both
 * families share one16MiB pool and retain separate exact capture provenance. */
export function createRealisticRegionalWoodland(options:Options,prepareResources=createVegetationPrototypeResources){
 const native=!!options.native,source=options.source;
 if(source.family!==REALISTIC_TREE_FAMILY||source.variant!==2||source.triangles!==9883)throw Error('Unqualified primary complete-tree source.');
 const forestSource=!native&&options.forest01Source?.family===REALISTIC_FOREST01_FAMILY&&options.forest01Source.variant===1&&options.forest01Source.triangles===58411?options.forest01Source:null;
 const budget=createRealisticTreeBudget(native,!!forestSource),retirement=createWorldResourceRetirementFence(options.renderer,options.queue),fence=options.retirementFence??retirement;
 const identity=(value:NormalizedRealisticTreeSource):VegetationPersistentIdentity=>({worldRegion:REALISTIC_TREE_COHORT_VERSION+':'+value.family,sourceSha256:value.sourceSha256,backend:native?'iwsdk-r185-webgl2-complete-tree-v1':'three-r185-webgl2-complete-tree-v1'});
 const known=(parts:readonly VegetationCapturePart[],value:NormalizedRealisticTreeSource)=>parts.length===value.parts.length&&parts.every(part=>value.parts.some(original=>part.geometry===original.geometry&&part.material===original.material))&&value.parts.every(original=>parts.some(part=>part.geometry===original.geometry&&part.material===original.material));
 const resources=prepareResources(options.renderer,options.queue,options.worker,realisticTreeMemoryBudget(native),identity(source),parts=>{if(forestSource&&known(parts,forestSource))return identity(forestSource);if(known(parts,source))return undefined;throw Error('Unqualified capture source in the shared complete-tree pool.');});
 const pp3Scope=scopeRealisticTreeResources(resources,fence),forestScope=forestSource?scopeRealisticTreeResources(resources,fence):null;
 let plan=realisticTreeDetailPlan(native,false),disposed=false;
 const localFence:NonNullable<Options['ownerRetirementFence']>=options.ownerRetirementFence??(options.retirementFence?()=>options.retirementFence!():proof=>retirement.afterOwnerQuiescent(proof));
 const pp3=createRealisticRegionalTrees({...options,ownedNearResources:resources,ownerRetirementFence:localFence,retirementFence:fence,detailLimit:()=>plan.pp3,detailBudget:{acquire:id=>budget.acquire('pp3',id)}},()=>pp3Scope.resources);
 const forest=forestSource&&forestScope?createRealisticRegionalTrees({...options,ownedNearResources:resources,ownerRetirementFence:localFence,source:forestSource,cohortKey:'realisticForest01Trees',retirementFence:fence,detailLimit:()=>1,detailBudget:{acquire:(id,role)=>budget.acquire('forest01',id,role)},densityRole:{primaryReady:()=>pp3.primarySettled&&budget.stats.retiring===0,canPrepare:()=>resources.stats.reservedBytes===0}},()=>forestScope.resources):null;
 const object=new Group();object.name='Ealdholt shared bounded authored woodland';object.userData.iwsdkPreviewBounds='exclude';object.add(pp3.object);if(forest)object.add(forest.object);
 const levels=[0,0,0,0],children=forest?[pp3.stats,forest.stats]:[pp3.stats],counterKeys=['eligible','examined','rejectedRoots','rejectedWalking','heldWalkingUncertain','detailed','preparing','retiring','visible','far','canopies']as const;
 const stats={...pp3.stats,levels,pp3:pp3.stats,forest01:forest?.stats??null,budget:budget.stats,resourcePool:resources.stats,maximumCombinedCohort:REALISTIC_TREE_COHORT_LIMIT,sourceTriangleCosts:{pp3:source.triangles,forest01:forestSource?.triangles??0,forest01Density:forestSource?FOREST01_DENSITY_LOD.triangles:0},memoryBudgetBytes:realisticTreeMemoryBudget(native),gpuSharedRetirement:retirement.stats};
 function report(){Object.assign(stats,pp3.stats);stats.levels=levels;levels.fill(0);let ready=false,preparing=false,fallback=true;
  for(const key of counterKeys)stats[key]=0;
  for(const child of children){ready=ready||child.status==='ready';preparing=preparing||child.status==='preparing';fallback=fallback&&child.status==='fallback';for(const key of counterKeys)stats[key]+=child[key];for(let i=0;i<4;i++)levels[i]+=child.levels[i];}
  stats.status=disposed?'disposed':preparing?'preparing':ready?'ready':fallback?'fallback':'unavailable';stats.detailLimit=plan.pp3+plan.forest01+(forest?.stats.densityEligible&&plan.forest01?1:0);stats.maximumSourceTriangles=budget.stats.maximumSourceTriangles;stats.maximumTransitionTriangles=budget.stats.maximumTransitionTriangles;
 }
 function dispose(){if(disposed)return;disposed=true;options.signal.removeEventListener('abort',dispose);object.removeFromParent();pp3.dispose();forest?.dispose();report();
  void Promise.all([pp3Scope.disposed,...(forestScope?[forestScope.disposed]:[])]).then(()=>fence()).then(()=>{resources.dispose();object.clear();});
 }
 options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted)dispose();
 return{object,stats,resources:resources.stats,
  async prepare(layout:RegionalWorldLayout){const total=(layout.realisticTrees?.ids.length??0)+(layout.realisticForest01Trees?.ids.length??0);await Promise.all([pp3.prepare(layout),forest?.prepare(total<=REALISTIC_TREE_COHORT_LIMIT?layout:{...layout,realisticForest01Trees:undefined})]);report();},
  owns(id:number){return pp3.owns(id)||!!forest?.owns(id);},
  update(camera:Camera,now:number,quality:'low'|'medium'|'high',reducedMotion:boolean,visible:ReadonlySet<number>){
   if(disposed)return false;plan=realisticTreeDetailPlan(native,!!forest?.hasNearCandidate(camera,visible));
   const transition=pp3.update(camera,now,quality,reducedMotion,visible),forestTransition=forest?.update(camera,now,quality,reducedMotion,visible)??false;resources.trim();report();return transition||forestTransition;
  },dispose};
}
export type RealisticRegionalWoodland=ReturnType<typeof createRealisticRegionalWoodland>;
