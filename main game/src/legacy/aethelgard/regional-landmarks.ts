import {Box3,BoxGeometry,Group,Matrix4,Mesh,MeshStandardMaterial,Vector3,type Camera,type Object3D} from 'three';
import type {RegionalLandmark} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import {createRegionLifecycle,type RegionRequest} from '../../../../shared/legacy/aethelgard/environment/region-lifecycle';

type Detail='far'|'full';
type Prepared={model:Object3D;bounds:Box3;triangles:number;drawCalls:number};
type Entry={placement:RegionalLandmark;owner:string;farKey:string;fullKey:string;group:Group;active:Detail|null;desired:Detail;foundation:Mesh<BoxGeometry,MeshStandardMaterial>|null};
/** Source-derived working landmarks. Presentation requests never own the
 * persistent village, its residents, authored geography, collision or anchors. */
export function createRegionalLandmarks(options:{sourceRoot:Object3D;camera:Camera;native?:boolean;
 // Shared template work uses the root/view lifetime, never a presentation request.
 load(id:RegionalLandmark['id'],detail:Detail,cacheSignal?:AbortSignal):Promise<Object3D>;
 signal:AbortSignal;changed():void;now?:()=>number}){
 const object=new Group();object.name='Ealdholt distant regional landmarks';object.userData.iwsdkPreviewBounds='exclude';
 object.userData.crownfallRegionalLandmarks={nonSolid:true,canonicalNames:false,sourceActorsUntouched:true};
 const borrowedTemplates=new Map<string,Promise<Object3D>>();
 const entries=new Map<RegionalLandmark['id'],Entry>(),inverse=new Matrix4(),eye=new Vector3(),size=new Vector3();
 let disposed=false,ownerGeneration=0;
 const key=(entry:Entry,detail:Detail)=>detail==='far'?entry.farKey:entry.fullKey;
 const stats={status:'awaiting-ground',error:'',loaded:0,rendered:[] as string[],submittedRendererFrame:-1,triangles:0,drawCalls:0,
  lods:{far:0,full:0},placements:[] as RegionalLandmark[],regions:[] as ReturnType<typeof createRegionLifecycle<Prepared>>['records'],
  ownership:{borrowedTemplates:'asset-cache',ownedPreparations:0,detachedFull:0,maximumDetachedFull:1,sharedFetchCancellation:false,borrowedTemplateSlots:0,pendingTemplateFetches:0}};
 function entryFor(request:RegionRequest){
  const entry=entries.get(request.key.split(':')[0] as RegionalLandmark['id']);
  return entry?.owner===request.owner?entry:null;
 }
 function drawStats(){
  stats.triangles=0;stats.drawCalls=0;stats.lods.far=stats.lods.full=0;stats.loaded=0;
  for(const e of entries.values()){
   if(!e.active)continue;stats.loaded++;stats.lods[e.active]++;
   const prepared=lifecycle.resource(key(e,e.active),e.owner);if(prepared){stats.drawCalls+=prepared.drawCalls;stats.triangles+=prepared.triangles;}
  }
  stats.ownership.borrowedTemplateSlots=borrowedTemplates.size;stats.ownership.ownedPreparations=0;stats.ownership.detachedFull=0;stats.error='';
  let failedFar=false;
  for(const r of lifecycle.records){
   if(r.resident)stats.ownership.ownedPreparations++;
   if(r.resident&&r.phase!=='attached'&&!r.retained&&r.key.endsWith(':full'))stats.ownership.detachedFull++;
   if(r.error&&r.phase==='failed'){stats.error=r.error;if(r.key.endsWith(':far'))failedFar=true;}
  }
  stats.status=disposed?'disposed':!entries.size?'awaiting-ground':stats.loaded===entries.size?'ready':failedFar?'held-error':'loading';
 }
 function changed(){if(disposed)return;drawStats();options.changed();}
 function borrowedTemplate(e:Entry,detail:Detail){
  const cacheKey=key(e,detail),existing=borrowedTemplates.get(cacheKey);if(existing)return existing;
  // Desktop's root loader owns returned GLBs but does not deduplicate parses.
  // Keep at most the fixed four template promises across owner changes and
  // clone evictions. A superseded presentation cannot abort this shared work.
  stats.ownership.pendingTemplateFetches++;
  const pending=Promise.resolve().then(()=>options.load(e.placement.id,detail,options.signal)).then(template=>{
   stats.ownership.pendingTemplateFetches--;return template;
  },cause=>{stats.ownership.pendingTemplateFetches--;if(borrowedTemplates.get(cacheKey)===pending)borrowedTemplates.delete(cacheKey);stats.ownership.borrowedTemplateSlots=borrowedTemplates.size;throw cause;});
  borrowedTemplates.set(cacheKey,pending);stats.ownership.borrowedTemplateSlots=borrowedTemplates.size;return pending;
 }
 function modelCopy(template:Object3D,p:RegionalLandmark):Prepared{
  const model=template.clone(true);model.name=p.id;const bounds=new Box3().setFromObject(template);
  // Fort cliffs extend below its y=0 ground contact and remain buried.
  model.position.y-=p.id==='temple-ruins'?bounds.min.y:0;let triangles=0,drawCalls=0;
  model.traverse(node=>{if(node instanceof Mesh){drawCalls+=Math.max(1,node.geometry.groups.length);triangles+=(node.geometry.index?.count??node.geometry.getAttribute('position')?.count??0)/3;node.castShadow=false;node.receiveShadow=true;node.raycast=()=>{};
   node.onAfterRender=(renderer,_scene,camera)=>{if(camera!==options.camera||disposed)return;const frame=renderer.info.render.frame;
    if(frame!==stats.submittedRendererFrame){stats.submittedRendererFrame=frame;stats.rendered.length=0;}
    if(!stats.rendered.includes(p.id))stats.rendered.push(p.id);
   };
  }});return{model,bounds,triangles,drawCalls};
 }
 function foundation(e:Entry,bounds:Box3){
  if(e.foundation)return;bounds.getSize(size);const p=e.placement,depth=Math.max(2,p.foundationDepth);
  const geometry=new BoxGeometry(p.id==='western-fort'?50:Math.min(size.x,p.radius*1.5),depth,p.id==='western-fort'?50:Math.min(size.z,p.radius*1.5));
  const material=new MeshStandardMaterial({color:'#625e50',roughness:1});e.foundation=new Mesh(geometry,material);e.foundation.position.y=-depth/2+.05;e.group.add(e.foundation);
 }
 function commit(e:Entry,detail:Detail){
  const prior=e.active;
  if(!lifecycle.attach(key(e,detail),e.owner))return;
  e.active=detail;
  // Replacement is prepared and attached before the old view is detached.
  if(prior&&prior!==detail)lifecycle.detach(key(e,prior),e.owner);
  changed();
 }
 const lifecycle=createRegionLifecycle<Prepared>({keys:['western-fort:far','western-fort:full','temple-ruins:far','temple-ruins:full'],maxDetached:1,idleMs:15_000,maxFailures:3,retryDelayMs:1_000,now:options.now,
  async load(request){
   const e=entryFor(request);if(!e)throw Error('Regional presentation owner superseded.');
   const detail=request.key.endsWith(':full')?'full':'far';
   const template=await borrowedTemplate(e,detail);
   // The loader returns a borrowed template. A late completion must not clone,
   // parent or dispose it, even when the underlying cache ignored this signal.
   request.signal.throwIfAborted();
   if(!request.isCurrent()||entryFor(request)!==e)throw Error('Regional presentation request superseded.');
   return modelCopy(template,e.placement);
  },
  attach(prepared,request){const e=entryFor(request);if(e){foundation(e,prepared.bounds);e.group.add(prepared.model);}},
  detach(prepared){prepared.model.removeFromParent();},
  release(prepared){
   prepared.model.removeFromParent();
   // Object3D.clone shares the template's geometry/materials/textures. Release
   // only our hierarchy and callbacks; the root asset cache retains GPU owners.
   prepared.model.traverse(node=>{if(node instanceof Mesh)node.onAfterRender=()=>{};});prepared.model.clear();
  },
  prepared(request){const e=entryFor(request);if(!e)return;
   const detail=request.key.endsWith(':full')?'full':'far';
   if(detail===e.desired||!e.active)commit(e,detail);
  },changed,
 });
 stats.regions=lifecycle.records;
 function remove(e:Entry){
  e.active=null;lifecycle.forget(key(e,'full'),e.owner);lifecycle.forget(key(e,'far'),e.owner);
  if(e.foundation){e.foundation.geometry.dispose();e.foundation.material.dispose();e.foundation=null;}
  e.group.removeFromParent();e.group.clear();entries.delete(e.placement.id);
 }
 function dispose(){
  if(disposed)return;disposed=true;lifecycle.dispose();for(const e of entries.values())remove(e);
  borrowedTemplates.clear();object.removeFromParent();object.clear();stats.rendered.length=0;stats.submittedRendererFrame=-1;drawStats();
  options.signal.removeEventListener('abort',dispose);
 }
 options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted)dispose();
 return{object,stats,beginFrame(){stats.rendered.length=0;stats.submittedRendererFrame=-1;},
  update(placements:readonly RegionalLandmark[]){
   if(disposed)return;
   // Placement ownership includes every source transform/support measurement.
   // A revised layout replaces only its presentation, never persistent identity.
   let layoutChanged=false;
   for(const e of entries.values()){
    let p:RegionalLandmark|undefined;for(const candidate of placements)if(candidate.id===e.placement.id){p=candidate;break;}const a=e.placement;
    if(!p||p.x!==a.x||p.y!==a.y||p.z!==a.z||p.yaw!==a.yaw||p.radius!==a.radius||p.foundationDepth!==a.foundationDepth){remove(e);layoutChanged=true;}
   }
   for(const p of placements)if(!entries.has(p.id)){
    const group=new Group();group.name=p.id==='western-fort'?'Western sea fort':'Inland temple ruins';group.position.set(p.x,p.y,p.z);group.rotation.y=p.yaw;
    group.userData.iwsdkPreviewBounds='exclude';group.userData.crownfallRegionalLandmarks=object.userData.crownfallRegionalLandmarks;
    entries.set(p.id,{placement:{...p},owner:p.id+':'+ ++ownerGeneration,farKey:p.id+':far',fullKey:p.id+':full',group,active:null,desired:'far',foundation:null});object.add(group);layoutChanged=true;
   }
   if(layoutChanged)stats.placements=Array.from(entries.values(),e=>({...e.placement}));
   options.sourceRoot.updateWorldMatrix(true,false);inverse.copy(options.sourceRoot.matrixWorld).invert();options.camera.getWorldPosition(eye).applyMatrix4(inverse);
   for(const e of entries.values()){
    const p=e.placement,distance=Math.hypot(eye.x-p.x,eye.y-p.y,eye.z-p.z);
    e.desired=!options.native&&distance<(e.desired==='full'?300:220)?'full':'far';
    lifecycle.request(e.farKey,e.owner);
    if(e.desired==='full'&&lifecycle.resource(e.farKey,e.owner))lifecycle.request(e.fullKey,e.owner);
    else if(e.desired==='far')lifecycle.unretain(e.fullKey,e.owner);
    if(e.active!==e.desired)commit(e,e.desired);
   }
   lifecycle.sweep();drawStats();
  },
  retryFailed(){if(disposed)return;for(const e of entries.values())for(const detail of ['far','full'] as const)lifecycle.retry(key(e,detail),e.owner);options.changed();},
  dispose};
}
export type RegionalLandmarks=ReturnType<typeof createRegionalLandmarks>;
