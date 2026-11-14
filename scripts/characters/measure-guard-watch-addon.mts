/** CPU proof for the real published guard, original spear and additive clips.
 * No rendering, asset replacement, scene/save writes or invented capsule size.
 * Both platform Three runtimes sample the full skin and kit at 60Hz. */
import fs from 'node:fs';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {performance} from 'node:perf_hooks';
import {EALDHOLT_POPULATION_ASSET_SHA256 as hashes} from '../../shared/legacy/aethelgard/characters/population-asset-integrity.ts';
import {GUARD_WATCH_LOOP as LOOP,GUARD_WATCH_WALK as WALK,GUARD_WATCH_ENTER as ENTER,GUARD_WATCH_EXIT as EXIT,GUARD_WATCH_HELPER as HELPER} from '../../shared/legacy/aethelgard/characters/guard-watch-dwell.ts';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const inside=(base:string,p:string)=>{const r=relative(base,p);return r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};
function cpuGlb(bytes:Buffer):ArrayBuffer{
  const size=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+size).toString());
  delete json.images;delete json.textures;delete json.samplers;
  for(const material of json.materials??[]){for(const key of Object.keys(material))if(key.endsWith('Texture'))delete material[key];
    if(material.pbrMetallicRoughness){delete material.pbrMetallicRoughness.baseColorTexture;delete material.pbrMetallicRoughness.metallicRoughnessTexture;}}
  let data=Buffer.from(JSON.stringify(json));data=Buffer.concat([data,Buffer.alloc((4-data.length%4)%4,32)]);
  const bin=bytes.subarray(20+size),out=Buffer.alloc(20+data.length+bin.length);
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(data.length,12);out.writeUInt32LE(0x4e4f534a,16);
  data.copy(out,20);bin.copy(out,20+data.length);return out.buffer.slice(out.byteOffset,out.byteOffset+out.length);
}
export async function measureGuardWatch(argv=process.argv.slice(2)){
 const {values}=parseArgs({args:argv,options:{'assets-root':{type:'string'},'addon-dir':{type:'string'},out:{type:'string'},'max-ms':{type:'string',default:'120000'},'contacts-only':{type:'boolean',default:false}}});
 if(!values['assets-root']||!values['addon-dir']||!values.out)throw Error('Need --assets-root, --addon-dir and new private --out.');
 const root=fs.realpathSync(values['assets-root']),addonDir=fs.realpathSync(values['addon-dir']),out=resolve(values.out);
 if(fs.existsSync(out)||inside(repo,out)||inside(root,out)||inside(addonDir,out))throw Error('Use a new private output outside input/checkout trees.');
 const max=Number(values['max-ms']);if(!Number.isSafeInteger(max)||max<1000||max>300000)throw Error('Invalid bounded measurement budget.');
 const started=performance.now(),budget=()=>{if(performance.now()-started>max)throw Error('Guard measurement time budget exceeded.');};
 const provenance=JSON.parse(fs.readFileSync(resolve(addonDir,'provenance.json'),'utf8')),raw=fs.readFileSync(resolve(addonDir,provenance.output.file));
 if(sha(raw)!==provenance.output.sha256||raw.length!==provenance.output.bytes)throw Error('Addon bytes changed after export.');
 const paths={body:'crowd-v1/residents/ealdholt-garrison-spearman.glb',meta:'crowd-v1/residents/ealdholt-garrison-spearman.json',base:'crowd-v1/clips/crowd-clips-adult-male-v1.glb',kit:'crowd-v1/props/crowd-props-guard-v1.glb'};
 const source:any={};for(const path of Object.values(paths)){const file=fs.realpathSync(resolve(root,path));if(!inside(root,file))throw Error('Source symlink escapes asset root.');
   const b=fs.readFileSync(file);if(sha(b)!==hashes[path]||sha(b)!==provenance.sources[path])throw Error('Published input identity mismatch '+path);source[path]=b;}
 const meta=JSON.parse(source[paths.meta].toString()),seconds=provenance.seconds,fadeSeconds=.12;
 const handoff=provenance.handoff;
 if(!handoff||!Number.isFinite(handoff.leftClosedByPhase)||!Number.isFinite(handoff.rightReleaseAfterPhase)
   ||handoff.leftClosedByPhase<=0||handoff.leftClosedByPhase>handoff.rightReleaseAfterPhase||handoff.rightReleaseAfterPhase>=1)
   throw Error('The exported handoff must have a real two-hand overlap.');
 const report:any={schemaVersion:1,method:'actual-platform-animationmixer-full-skin-and-held-spear-v1',fps:60,paddingMetres:.05,
  generator:{file:'scripts/characters/measure-guard-watch-addon.mts',sha256:sha(fs.readFileSync(fileURLToPath(import.meta.url)))},
  sources:{...provenance.sources},addon:{file:provenance.output.file,sha256:sha(raw),bytes:raw.length},seconds,fadeSeconds,platforms:{},contactsOnlyDiagnostic:values['contacts-only'],
  exactSourceSiteCapsule:'not-written-or-inferred; runtime compares measured bounds against its existing certificate',completed:false};
 for(const platform of ['desktop','quest'] as const){
  budget();const prefix=platform==='desktop'?'main game':'main-game-vr';
  const THREE:any=await import(new URL('../../'+prefix+'/node_modules/three/build/three.module.js',import.meta.url).href);
  const {GLTFLoader}=await import(new URL('../../'+prefix+'/node_modules/three/examples/jsm/loaders/GLTFLoader.js',import.meta.url).href);
  const adapter=await import(new URL('../../'+prefix+'/src/legacy/aethelgard/characters/crowd-residents.ts',import.meta.url).href);
  const correctionModule=await import(new URL('../../'+prefix+'/src/legacy/aethelgard/characters/guard-watch-pose-correction.ts',import.meta.url).href);
  (globalThis as any).self=globalThis;const loader=new GLTFLoader();
  const [body,base,addon,kit]=await Promise.all([source[paths.body],source[paths.base],raw,source[paths.kit]].map((b:Buffer)=>loader.parseAsync(cpuGlb(b),'')));
  const library=adapter.prepareGuardWatchLibrary(adapter.prepareCrowdLibrary(base),adapter.prepareCrowdLibrary(addon));
  adapter.bindCrowdTemplate(body,library,true);
  const model=body.scene;model.scale.setScalar(meta.placementScale);
  const prop=kit.scene.getObjectByName('prop_spear')?.clone(true),helper=model.getObjectByName(HELPER);
  if(!prop||!helper)throw Error('Actual original spear or authored helper is absent.');
  prop.matrixAutoUpdate=false;prop.matrix.identity();helper.add(prop);
  const mixer=new THREE.AnimationMixer(model),meshes:any[]=[];model.traverse((o:any)=>{if(o.isMesh)meshes.push(o);});
  if(!provenance.soles||!provenance.grips)throw Error('Actual measured shoe supports and existing grips are required.');
  const poseSpec={soles:provenance.soles,grips:provenance.grips,handoff:provenance.handoff,seconds};
  const correction=correctionModule.createGuardWatchPoseCorrection(model,poseSpec);let maximumFootCorrectionMetres=0;
  const ownerMotions:any={[WALK]:'walk',[LOOP]:'work',[ENTER]:'workEnter',[EXIT]:'workExit'};
  function correct(name:string,time:number){const result=correction.apply(ownerMotions[name],time);
    maximumFootCorrectionMetres=Math.max(maximumFootCorrectionMetres,result.maximumLift);if(!result.ok)throw Error(result.reason);}
  if(!meshes.some(o=>o.isSkinnedMesh))throw Error('Actual skinned guard is missing.');
  const aggregate=()=>({radiusMetres:0,heightMetres:-Infinity,minimumBodyYMetres:Infinity,minimumPropYMetres:Infinity});
  const v=new THREE.Vector3(),m=new THREE.Matrix4();let vertexSamples=0;
  function measure(target:any){model.updateMatrixWorld(true);if(values['contacts-only'])return;for(const mesh of meshes){const position=mesh.geometry.getAttribute('position');
    for(let i=0;i<position.count;i++){mesh.getVertexPosition(i,v);v.applyMatrix4(mesh.matrixWorld);
      target.radiusMetres=Math.max(target.radiusMetres,Math.hypot(v.x,v.z));target.heightMetres=Math.max(target.heightMetres,v.y);
      const isProp=mesh===prop||isDescendant(mesh,prop);const field=isProp?'minimumPropYMetres':'minimumBodyYMetres';target[field]=Math.min(target[field],v.y);vertexSamples++;}}
  }
  function isDescendant(node:any,parent:any){for(let p=node.parent;p;p=p.parent)if(p===parent)return true;return false;}
  let maximumHandGapMetres=0,maximumGripAngleDegrees=0,worstHand:any=null,worstAngle:any=null,context='';
  const rotation=(matrix:any)=>new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(matrix)).normalize();
  function contact(name:string,time:number){
    const u=name===EXIT?1-time/seconds:time/seconds;
    const sides=name===WALK?['r']:name===LOOP?['l']:[...(u<=handoff.rightReleaseAfterPhase?['r']:[]),...(u>=handoff.leftClosedByPhase?['l']:[])];
    for(const side of sides){const original=meta.presentation.clips[side==='r'?WALK:LOOP].held[0];
      const expected=new THREE.Matrix4().multiplyMatrices(model.getObjectByName('hand_'+side).matrixWorld,m.fromArray(original.matrix));
      const gap=new THREE.Vector3().setFromMatrixPosition(expected).distanceTo(new THREE.Vector3().setFromMatrixPosition(helper.matrixWorld));
      const a=rotation(expected),b=rotation(helper.matrixWorld);
      const angle=a.angleTo(b)*180/Math.PI;
      if(gap>maximumHandGapMetres){maximumHandGapMetres=gap;worstHand={context,name,time,side,gap,angle};}
      if(angle>maximumGripAngleDegrees){maximumGripAngleDegrees=angle;worstAngle={context,name,time,side,gap,angle};}
    }
  }
  const clips:any={},actions=new Map<string,any>();
  for(const name of [WALK,LOOP,ENTER,EXIT]){const action=mixer.clipAction(library.clip(name));action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;actions.set(name,action);}
  const pose=(name:string,time:number)=>{correction.restore();mixer.stopAllAction();const a=actions.get(name);a.reset().play();a.time=time;a.setEffectiveWeight(1);mixer.update(0);correct(name,time);model.updateMatrixWorld(true);};
  for(const name of [WALK,LOOP,ENTER,EXIT]){
    context='single-clip:'+name;
    const bounds=aggregate(),clip=library.clip(name),steps=Math.ceil(clip.duration*60);
    for(let i=0;i<=steps;i++){if(i%60===0)budget();const time=Math.min(i/60,clip.duration);pose(name,time);measure(bounds);contact(name,time);}
    clips[name]={...bounds,radiusMetres:bounds.radiusMetres+.05,heightMetres:bounds.heightMetres+.05,samples:steps+1};
  }
  // Exact authored seams, including the independently keyed actual spear.
  const nodes=library.joints.concat(HELPER),seams:any[]=[];
  const worldPose=()=>new Map(nodes.map((name:string)=>[name,model.getObjectByName(name).matrixWorld.clone()]));
  for(const [from,fromTime,to,toTime]of [[WALK,0,ENTER,0],[ENTER,seconds,LOOP,0],[LOOP,0,EXIT,0],[EXIT,seconds,WALK,0]] as const){
    pose(from,fromTime);const a:any=worldPose();pose(to,toTime);let position=0,angle=0;
    for(const name of nodes){const b=model.getObjectByName(name).matrixWorld;
      position=Math.max(position,new THREE.Vector3().setFromMatrixPosition(a.get(name)).distanceTo(new THREE.Vector3().setFromMatrixPosition(b)));
      angle=Math.max(angle,rotation(a.get(name)).angleTo(rotation(b))*180/Math.PI);}
    seams.push({from,fromTime,to,toTime,maximumPositionMetres:position,maximumAngleDegrees:angle});
  }
  const blends=aggregate();let blendSamples=0;
  const cases=[[WALK,ENTER,true],[ENTER,LOOP,false],[LOOP,EXIT,true],[EXIT,WALK,false]] as const;
  for(const [from,to,loop]of cases){
    const duration=library.clip(from).duration,phaseCount=loop?Math.ceil(duration*60):1;
    for(let phase=0;phase<=phaseCount;phase++){
      budget();const at=loop?Math.min(phase/60,duration):Math.max(0,duration-fadeSeconds);
      context='blend:'+from+'@'+at+'->'+to;
      const a=actions.get(from),b=actions.get(to);correction.restore();mixer.stopAllAction();a.reset().play();b.reset().play();
      for(let i=0;i<=Math.ceil(fadeSeconds*60);i++){
        const t=Math.min(i/60,fadeSeconds),w=t/fadeSeconds;
        a.time=loop?(at+t)%duration:Math.min(at+t,duration);a.setEffectiveWeight(1-w);
        b.time=t;b.setEffectiveWeight(w);correction.restore();mixer.update(0);correct(to,t);measure(blends);contact(to,t);blendSamples++;
      }
    }
  }
  // Check that the real owner and this measurement evaluate the same blend.
  pose(WALK,.25);const ownerModule=await import(new URL('../../'+prefix+'/src/legacy/aethelgard/resident-actors.ts',import.meta.url).href);
  // Match the real presenter: the owner clones/qualifies the body first, then
  // the caller attaches fixed-matrix borrowed props to that clone's helper.
  correction.restore();model.updateMatrixWorld(true);prop.removeFromParent();
  const owner=ownerModule.createEaldholtResidentActors({scene:model,animations:library.gltf.animations},[{residentId:meta.residentId,position:[0,0,0],yawRadians:0}],
    {clips:{idle:library.clip('idle_b'),walk:library.clip(WALK),work:library.clip(LOOP),workEnter:library.clip(ENTER),workExit:library.clip(EXIT)}});
  helper.add(prop);owner.actors[0].model.getObjectByName(HELPER).add(prop.clone(true));
  const ownerCorrection=correctionModule.createGuardWatchPoseCorrection(owner.actors[0].model,poseSpec);
  const updateOwner=(dt:number,frame:any)=>{ownerCorrection.restore();owner.update(dt,frame);const actor=owner.actors[0];
    const name=({walk:WALK,work:LOOP,workEnter:ENTER,workExit:EXIT} as any)[actor.activeMotion];
    const action=actor.mixer.existingAction(library.clip(name));const result=ownerCorrection.apply(actor.activeMotion,action.time);if(!result.ok)throw Error(result.reason);};
  const frame:any={clockSeconds:0,paused:false,reducedMotion:false,residents:[{residentId:meta.residentId,motion:'walk',animationTimeSeconds:.25,fadeSeconds:0}]};
  updateOwner(0,frame);frame.residents[0]={residentId:meta.residentId,motion:'workEnter',animationTimeSeconds:0,fadeSeconds};updateOwner(0,frame);
  frame.clockSeconds=.06;frame.residents[0].animationTimeSeconds=.06;updateOwner(.06,frame);
  correction.restore();mixer.stopAllAction();const a=actions.get(WALK),b=actions.get(ENTER);a.reset().play();b.reset().play();a.time=.31;a.setEffectiveWeight(.5);b.time=.06;b.setEffectiveWeight(.5);mixer.update(0);correct(ENTER,.06);model.updateMatrixWorld(true);
  let ownerMatrixError=0;const actual=owner.actors[0].model;actual.updateMatrixWorld(true);
  for(const name of nodes){const x=model.getObjectByName(name).matrixWorld.elements,y=actual.getObjectByName(name).matrixWorld.elements;
    for(let i=0;i<16;i++)ownerMatrixError=Math.max(ownerMatrixError,Math.abs(x[i]-y[i]));}owner.dispose();
  const padded={...blends,radiusMetres:blends.radiusMetres+.05,heightMetres:blends.heightMetres+.05};
  const pass=maximumHandGapMetres<=.03&&maximumGripAngleDegrees<=3&&ownerMatrixError<=1e-6
    &&seams.every(s=>s.maximumPositionMetres<=.002&&s.maximumAngleDegrees<=.5)
    &&Object.values(clips).concat(padded).every((b:any)=>b.radiusMetres<=.85&&b.heightMetres<=3.5&&b.minimumBodyYMetres>=-.03&&b.minimumPropYMetres>=-.03);
  const sourceModules=['src/legacy/aethelgard/characters/crowd-residents.ts','src/legacy/aethelgard/characters/guard-watch-pose-correction.ts','src/legacy/aethelgard/resident-actors.ts'];
  const sourceModuleSha256=Object.fromEntries(sourceModules.map(path=>[prefix+'/'+path,sha(fs.readFileSync(resolve(repo,prefix,path)))]));
  sourceModuleSha256['shared/legacy/aethelgard/characters/guard-watch-ik.ts']=sha(fs.readFileSync(resolve(repo,'shared/legacy/aethelgard/characters/guard-watch-ik.ts')));
  report.platforms[platform]={threeRevision:THREE.REVISION,sourceModuleSha256,clips,blends:padded,blendSamples,maximumHandGapMetres,maximumGripAngleDegrees,
    seams,ownerMatrixError,vertexSamples,worstHand,worstAngle,maximumFootCorrectionMetres,fps:60,includesActualSkinAndHeldSpear:!values['contacts-only'],pass:pass&&!values['contacts-only']};
  mixer.uncacheRoot(model);
 }
 report.completed=!values['contacts-only'];report.pass=Object.values(report.platforms).every((p:any)=>p.pass);report.elapsedMilliseconds=performance.now()-started;
 fs.mkdirSync(out,{recursive:true,mode:0o700});fs.writeFileSync(resolve(out,'measurement.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({pass:report.pass,milliseconds:report.elapsedMilliseconds,output:resolve(out,'measurement.json')}));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await measureGuardWatch();
