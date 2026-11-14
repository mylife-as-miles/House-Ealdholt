import {AnimationMixer,Box3,Group,LoopOnce,Mesh,Ray,Skeleton,SkinnedMesh,Triangle,Vector3,type AnimationClip,type Object3D} from 'three';
import {createCrowdAssetCache,bindCrowdTemplate,prepareCrowdLibrary,type CrowdLoaderPort} from './characters/crowd-residents';
import {communityWoodCrowdMeta,COMMUNITY_WOOD_CLIP,COMMUNITY_WOOD_IMPACTS} from '../../../../shared/legacy/aethelgard/characters/community-wood-presentation';
import {parseCrowdResidentMeta} from '../../../../shared/legacy/aethelgard/characters/crowd-binding';
import {getPopulationArt} from '../../../../shared/legacy/aethelgard/characters/village-population-art';
import {EALDHOLT_POPULATION_ASSET_SHA256} from '../../../../shared/legacy/aethelgard/characters/population-asset-integrity';
import {ResidentAnimationExecution,qualifyResidentAnimationClip,householdResidentAnimationMarkers,type ResidentAnimationEvent} from '../../../../shared/legacy/aethelgard/characters/resident-animation-execution';
import type {ResidentRoutineActionPhysicalContext} from '../../../../shared/legacy/aethelgard/characters/resident-routine-actions';
import type {ResidentWorkstation,ResidentWorkstationEntry,ResidentWorkstationObservation} from '../../../../shared/legacy/aethelgard/characters/resident-workstations';
import type {PopulationMotionClipEvidence} from '../../../../shared/legacy/aethelgard/characters/population-motion-clearance';
import type {ResidentActionSource} from '../../../../shared/legacy/aethelgard/characters/resident-action-queue';

type Point=readonly[number,number,number];
export const WOOD_WORK_CLIP=COMMUNITY_WOOD_CLIP;
export const WOOD_WORK_IMPACT_SECONDS=COMMUNITY_WOOD_IMPACTS[0];
export interface WoodWorkplaceAnimationInput {
 readonly loader:CrowdLoaderPort;readonly assetRoot:string;readonly source:ResidentActionSource;
 readonly residentId?:'ealdholt-woodcutter'|'ealdholt-master-mason';readonly communityTimberPreparation?:true;
 readonly standPosition:Point;readonly yawRadians:number;
}
/** CPU and visible presentation share these exact published clips, grip
 * matrices, placement scale and authored source-marker time. */
export interface WoodWorkplaceAnimation {
 readonly object:Group;readonly contactPoint:Point;readonly files:Readonly<Record<string,string>>;
 readonly markerIds:readonly string[];readonly placementScale:number;
 readonly clipMeasurements:Readonly<Record<string,PopulationMotionClipEvidence>>;
 readonly workClipPresentation:NonNullable<ReturnType<typeof parseCrowdResidentMeta>['presentation']>['clips'][string];
 observe(context:ResidentRoutineActionPhysicalContext,lease:ResidentWorkstationEntry,station:ResidentWorkstation,millisecondsPerWorldMinute:number):ResidentWorkstationObservation|null;
 setInputVisible(value:boolean):void;dispose():void;
}
const RESIDENT='ealdholt-woodcutter';
function hash(path:string):string{const value=EALDHOLT_POPULATION_ASSET_SHA256[path.replace(/^aethelgard\/characters\//u,'')];if(!value)throw Error('Unpublished work animation asset: '+path);return value;}
function cloneRig(source:Object3D):{model:Object3D;skeletons:Skeleton[]}{
 const model=source.clone(true),original:Object3D[]=[],copies:Object3D[]=[],map=new Map<Object3D,Object3D>(),skeletons=new Map<Skeleton,Skeleton>();source.traverse(n=>original.push(n));model.traverse(n=>copies.push(n));
 if(original.length!==copies.length)throw Error('Work animation clone changed its source hierarchy.');for(let i=0;i<original.length;i++)map.set(original[i],copies[i]);
 for(let i=0;i<original.length;i++){const a=original[i],b=copies[i];if(!(a instanceof SkinnedMesh)||!(b instanceof SkinnedMesh))continue;let skeleton=skeletons.get(a.skeleton);
  if(!skeleton){const bones=a.skeleton.bones.map(node=>{const bone=map.get(node);if(!bone||!('isBone'in bone)||!bone.isBone)throw Error('Work animation bone escaped its original template.');return bone as typeof node;});skeleton=new Skeleton(bones,a.skeleton.boneInverses.map(m=>m.clone()));skeletons.set(a.skeleton,skeleton);}
  b.skeleton=skeleton;b.bindMatrix.copy(a.bindMatrix);b.bindMatrixInverse.copy(a.bindMatrixInverse);
 }
 return{model,skeletons:[...skeletons.values()]};
}
function attach(template:Object3D,parent:Object3D,matrix:readonly number[]):Object3D{
 const clone=template.clone(true);clone.matrixAutoUpdate=false;clone.matrix.fromArray(matrix);parent.add(clone);return clone;
}
function skinUpdate(root:Object3D):void{root.updateMatrixWorld(true);root.traverse(n=>{if(n instanceof SkinnedMesh)n.skeleton.update();});}
function triangles(root:Object3D):readonly Triangle[]{
 const rows:Triangle[]=[];root.updateMatrixWorld(true);root.traverse(node=>{if(!(node instanceof Mesh))return;const positions=node.geometry.attributes.position,index=node.geometry.index,count=index?.count??positions.count;
  for(let i=0;i<count;i+=3){const points=[0,1,2].map(k=>new Vector3().fromBufferAttribute(positions,index?index.getX(i+k):i+k).applyMatrix4(node.matrixWorld));rows.push(new Triangle(points[0],points[1],points[2]));}
 });return rows;
}
/** Exact source triangles, including edge/face piercing. Bounds alone cannot
 * authorize a wood contact. The actor's axe and finite input remain separate. */
function contactBetween(tool:Object3D,target:Object3D):{tool:Point;target:Point;distance:number}|null{
 const axes=triangles(tool),wood=triangles(target),ray=new Ray(),direction=new Vector3(),hit=new Vector3(),candidate=new Vector3();let best=Infinity,aBest=new Vector3(),bBest=new Vector3();
 const keep=(a:Vector3,b:Vector3)=>{const d=a.distanceTo(b);if(d<best){best=d;aBest.copy(a);bBest.copy(b);}};
 const edges=(a:Triangle,b:Triangle)=>{for(const[p,q]of[[a.a,a.b],[a.b,a.c],[a.c,a.a]]){direction.copy(q).sub(p);const length=direction.length();if(length<1e-12)continue;ray.origin.copy(p);ray.direction.copy(direction).divideScalar(length);const crossed=ray.intersectTriangle(b.a,b.b,b.c,false,hit);if(crossed&&p.distanceTo(hit)<=length+1e-9)keep(hit,hit);}};
 for(const axe of axes)for(const log of wood){edges(axe,log);edges(log,axe);for(const p of[axe.a,axe.b,axe.c]){log.closestPointToPoint(p,candidate);keep(p,candidate);}for(const p of[log.a,log.b,log.c]){axe.closestPointToPoint(p,candidate);keep(candidate,p);}}
 return Number.isFinite(best)?{tool:aBest.toArray()as unknown as Point,target:bBest.toArray()as unknown as Point,distance:best}:null;
}

export async function createWoodWorkplaceAnimation(input:WoodWorkplaceAnimationInput):Promise<WoodWorkplaceAnimation>{
 const resident=input.residentId??RESIDENT;if(resident!==RESIDENT&&input.communityTimberPreparation!==true)throw Error('Temporary community timber work requires its explicit assignment.');
 const art=getPopulationArt(resident);if(!art?.clipLibrary)throw Error('Wood work needs the existing published resident and clip library.');
 const root=input.assetRoot.endsWith('/')?input.assetRoot:input.assetRoot+'/',relative=(path:string)=>path.replace(/^aethelgard\/characters\//u,''),cache=createCrowdAssetCache(input.loader),files:Record<string,string>={};
 const bodyPath=relative(art.levels[0].path),metaPath=relative(art.manifest),libraryPath=relative(art.clipLibrary.path),load=async(path:string)=>{const sha=hash(path);files[path]=sha;const result=await cache.acquire(root+path,sha);if(!cache.verified(root+path))throw Error('Work animation source bytes were not verified.');return result;};
 try{
  files[metaPath]=hash(metaPath);const originalMeta=parseCrowdResidentMeta(await cache.json(root+metaPath,files[metaPath]),resident),meta=resident===RESIDENT?originalMeta:communityWoodCrowdMeta(originalMeta);if(!cache.verified(root+metaPath)||meta.residentId!==resident)throw Error('Work metadata was not source verified.');
  const[body,library]=await Promise.all([load(bodyPath),load(libraryPath)]),bound=bindCrowdTemplate(body,prepareCrowdLibrary(library)),clip=library.animations.find(c=>c.name===WOOD_WORK_CLIP),enter=library.animations.find(c=>c.name===WOOD_WORK_CLIP+'_enter'),exit=library.animations.find(c=>c.name===WOOD_WORK_CLIP+'_exit'),idle=library.animations.find(c=>c.name===meta.motion.idle);
  if(!bound||!clip||Math.abs(clip.duration-2.4)>1e-5||!enter||!exit||!idle||hash(libraryPath)!=='ecbb7f4646cb008ea06b02fa46029948e37ff826dd00bdcb6cac021a70d124e5')throw Error('Wood work clips or authored timing differ from the published source.');
  const workMeta=meta;if(resident!==RESIDENT){const donorPath='crowd-v1/residents/ealdholt-woodcutter.json';files[donorPath]=hash(donorPath);const donor=parseCrowdResidentMeta(await cache.json(root+donorPath,files[donorPath]),RESIDENT);if(!cache.verified(root+donorPath)||donor.archetype!==meta.archetype||JSON.stringify(donor.presentation?.clips[WOOD_WORK_CLIP])!==JSON.stringify(meta.presentation?.clips[WOOD_WORK_CLIP]))throw Error('Community work has no exact compatible published prop contract.');}
  const contract=workMeta.presentation?.clips[WOOD_WORK_CLIP],held=contract?.held.find(p=>p.prop==='axe'&&p.bone==='hand_r'),placed=contract?.placed.find(p=>p.prop==='chopping-block'&&p.bone===null);
  if(!held||!placed||!workMeta.presentation)throw Error('Wood work has no published axe/block placement.');
  const craftPath=workMeta.presentation.kits[held.kit],workplacePath=workMeta.presentation.kits[placed.kit],everydayPath='crowd-v1/props/crowd-props-everyday-v1.glb',[craft,workplace,everyday]=await Promise.all([load(craftPath),load(workplacePath),load(everydayPath)]);
  const axeTemplate=craft.scene.getObjectByName(held.node),blockTemplate=workplace.scene.getObjectByName(placed.node),inputTemplate=everyday.scene.getObjectByName('prop_kindling_bundle');if(!axeTemplate||!blockTemplate||!inputTemplate)throw Error('Published wood tools, block or finite-input bundle is absent.');
  const cloned=cloneRig(body.scene),model=cloned.model;model.position.fromArray(input.standPosition);model.rotation.y=input.yawRadians;model.scale.setScalar(meta.placementScale);const hand=model.getObjectByName(held.bone!);if(!hand)throw Error('Published hand socket is absent.');
  const axe=attach(axeTemplate,hand,held.matrix),block=attach(blockTemplate,model,placed.matrix),log=inputTemplate.clone(true);model.add(log);
  // The published motion targets a .73m log top; its actual block is .5m.
  // This existing input mesh is scaled onto that block, never created as stock.
  const bounds=new Box3().setFromObject(inputTemplate),height=bounds.max.y-bounds.min.y,top=.73,blockTop=.5;if(height<=0)throw Error('Finite-input bundle has no original height.');const scale=(top-blockTop)/height;
  log.scale.setScalar(scale);log.position.set(placed.matrix[12],blockTop-bounds.min.y*scale,placed.matrix[14]);
  const mixer=new AnimationMixer(model),actions=new Map([clip,enter,exit,idle].map(c=>[c.name,mixer.clipAction(c)]));let currentClip:AnimationClip|null=null,disposed=false,inputVisible=true,execution:ResidentAnimationExecution|null=null,executionLease='',executionThrough=0,lastObservation:ResidentWorkstationObservation|null=null,lastObservationKey='';
  for(const once of[enter,exit]){const action=actions.get(once.name)!;action.setLoop(LoopOnce,1);action.clampWhenFinished=true;}
  const pose=(selected:AnimationClip,seconds:number)=>{const action=actions.get(selected.name)!;if(currentClip!==selected){mixer.stopAllAction();action.reset();action.play();currentClip=selected;}action.paused=false;action.enabled=true;mixer.setTime(seconds);skinUpdate(model);};
  pose(clip,WOOD_WORK_IMPACT_SECONDS);const measured=contactBetween(axe,log);if(!measured||measured.distance>.02)throw Error('Published axe does not physically meet the finite input at its authored marker: '+(measured?.distance??'unavailable'));
  const clipMeasurements:Record<string,PopulationMotionClipEvidence>={};
  const sampledPoint=new Vector3();
  for(const sampled of[clip,enter,exit]){let radius=0,height=0,minimumY=Infinity;const frames=Math.ceil(sampled.duration*60);for(let i=0;i<=frames;i++){pose(sampled,Math.min(sampled.duration,i/60));model.traverse(node=>{if(!(node instanceof Mesh)||!node.visible)return;const points=node.geometry.attributes.position;for(let v=0;v<points.count;v++){node.getVertexPosition(v,sampledPoint);sampledPoint.applyMatrix4(node.matrixWorld);radius=Math.max(radius,Math.hypot(sampledPoint.x-input.standPosition[0],sampledPoint.z-input.standPosition[2]));height=Math.max(height,sampledPoint.y-input.standPosition[1]);minimumY=Math.min(minimumY,sampledPoint.y-input.standPosition[1]);}});}clipMeasurements[sampled.name]=Object.freeze({radiusMetres:radius+.05,heightMetres:height+.05,minimumBodyYMetres:minimumY,placedBelowGround:minimumY<-.005});}
  pose(clip,WOOD_WORK_IMPACT_SECONDS);
  const contactPoint=Object.freeze([...measured.target])as unknown as Point,visual=new Group();visual.name='EaldholtFiniteWoodInput';const visibleInput=log.clone(true);visual.add(visibleInput);visual.position.copy(model.position);visual.rotation.copy(model.rotation);visual.scale.copy(model.scale);visual.visible=false;
  const clipContract=qualifyResidentAnimationClip(WOOD_WORK_CLIP,clip.duration,true,householdResidentAnimationMarkers({impactSeconds:[WOOD_WORK_IMPACT_SECONDS]}));
  return{object:visual,contactPoint,files:Object.freeze(files),markerIds:Object.freeze(['impactSeconds:0']),placementScale:meta.placementScale,clipMeasurements:Object.freeze(clipMeasurements),workClipPresentation:contract!,
   setInputVisible(value){if(inputVisible!==value){lastObservation=null;lastObservationKey='';}inputVisible=value;visual.visible=value&&visual.visible;},
   observe(context,lease,station,millisecondsPerWorldMinute){
    if(disposed||context.source.profile!==input.source.profile||context.source.sha256!==input.source.sha256||context.source.siteIdentity!==input.source.siteIdentity||station.station.source.profile!==input.source.profile||station.station.source.sha256!==input.source.sha256||station.station.source.siteIdentity!==input.source.siteIdentity||context.residentId!==resident||!context.queue||!context.arrival||context.arrival.anchorId!==station.station.anchorId||context.queue.jobId!==lease.lease.jobId||context.queue.interruption||!Number.isFinite(millisecondsPerWorldMinute)||millisecondsPerWorldMinute<=0)return null;
    const q=context.queue,minute=context.absoluteMinute,phase=q.current,secondsPerMinute=millisecondsPerWorldMinute/1000,started=lease.performStartedAtMinute??minute;
    if(!inputVisible&&phase!=='release')return null;const key=JSON.stringify([context.worldKey,context.arrival.id,q.jobId,phase,minute,lease.lease.id,lease.performStartedAtMinute,lease.phase,lease.phaseStartedAtMinute,q.proof.lastContactMinute,station.station.certificateSha256,millisecondsPerWorldMinute]);if(key===lastObservationKey&&lastObservation)return lastObservation;axe.visible=true;
    let selected=idle,seconds=0,released=false,marker:ResidentAnimationEvent|null=null,physical:ReturnType<typeof contactBetween>=null;
    // Source work uses the presenter's explicit absolute clip clock. Published
    // personal variation scales free-running routines, not this paired timeline.
    if(phase==='reserve'||phase==='face'){selected=enter;seconds=Math.min(enter.duration,Math.max(0,minute-(lease.phase===phase?lease.phaseStartedAtMinute??lease.lease.sinceMinute:lease.lease.sinceMinute))*secondsPerMinute);}
    else if(phase==='perform'){
     selected=clip;seconds=Math.max(0,minute-started)*secondsPerMinute;
     if(executionLease!==lease.lease.id){executionLease=lease.lease.id;execution=new ResidentAnimationExecution(resident);executionThrough=Math.max(0,seconds-secondsPerMinute);execution.request('work',clipContract,executionLease,executionThrough);}
     pose(clip,seconds);execution!.stage(seconds);execution!.evaluate(true);execution!.drainEvents(event=>{if(event.kind==='marker'&&event.markerKind==='contact')marker=Object.freeze({...event});});executionThrough=seconds;
     if(marker){pose(clip,(marker as ResidentAnimationEvent).seconds%clip.duration);physical=contactBetween(axe,log);pose(clip,seconds);}
    }else if(phase==='release'){selected=exit;seconds=Math.min(exit.duration,Math.max(0,minute-(lease.phase===phase?lease.phaseStartedAtMinute??q.proof.lastContactMinute??minute:q.proof.lastContactMinute??minute))*secondsPerMinute);released=seconds>=exit.duration;}
    else return null;
    pose(selected,seconds);axe.visible=!released;visual.visible=inputVisible&&!released;
    const observation:ResidentWorkstationObservation={residentId:resident,jobId:q.jobId,stationId:station.station.id,atMinute:minute,source:context.source,stationCertificateSha256:station.station.certificateSha256,position:input.standPosition,yawRadians:input.yawRadians,poseSourceQualified:true,fullyWeighted:selected!==enter||seconds>=enter.duration,activeClip:selected.name,equipmentReleased:released,
     contact:marker&&physical&&physical.distance<=.02?{event:marker,toolPoint:physical.tool,targetPoint:physical.target,contactSourceActor:'prop_kindling_bundle'}:null};lastObservationKey=key;lastObservation=Object.freeze(observation);return lastObservation;
   },
   dispose(){if(disposed)return;disposed=true;mixer.stopAllAction();mixer.uncacheRoot(model);for(const skeleton of cloned.skeletons)skeleton.dispose();visual.removeFromParent();visual.clear();model.clear();cache.dispose();},
  };
 }catch(error){cache.dispose();throw error;}
}
