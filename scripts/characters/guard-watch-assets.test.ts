import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {EALDHOLT_POPULATION_ASSET_SHA256 as hashes} from '../../shared/legacy/aethelgard/characters/population-asset-integrity';
import {PUBLISHED_GUARD_WATCH as published} from '../../shared/legacy/aethelgard/characters/guard-watch-published';
import {guardWatchCrowdMeta,publishedGuardWatch,GUARD_WATCH_LOOP as LOOP,GUARD_WATCH_WALK as WALK,GUARD_WATCH_ENTER as ENTER,GUARD_WATCH_EXIT as EXIT,GUARD_WATCH_HELPER as HELPER,qualifyGuardWatchMotion} from '../../shared/legacy/aethelgard/characters/guard-watch-dwell';
import {parseCrowdResidentMeta,planCrowdClips,CODEX_OWNER_MOTIONS} from '../../shared/legacy/aethelgard/characters/crowd-binding';
import {planCrowdProps} from '../../shared/legacy/aethelgard/characters/crowd-presentation';
import {prepareCrowdLibrary,prepareGuardWatchLibrary,bindCrowdTemplate} from '../../main game/src/legacy/aethelgard/characters/crowd-residents';
import type {VillageSiteLayout} from '../../shared/legacy/aethelgard/characters/village-site';
import {EALDHOLT_VILLAGE_POPULATION as population} from '../../shared/legacy/aethelgard/characters/village-population';
import {selectVillagePresence} from '../../shared/legacy/aethelgard/characters/village-presence';
const root=new URL('../../main game/public/assets/legacy/environment/aethelgard/characters/',import.meta.url);
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function pinned(path:string){const b=fs.readFileSync(new URL(path,root));assert.equal(digest(b),hashes[path]);return b;}
function textureFree(b:Buffer){const n=b.readUInt32LE(12),g=JSON.parse(b.subarray(20,20+n).toString());delete g.images;delete g.textures;delete g.samplers;
 for(const m of g.materials??[]){for(const k of Object.keys(m))if(k.endsWith('Texture'))delete m[k];if(m.pbrMetallicRoughness){delete m.pbrMetallicRoughness.baseColorTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture;}}
 let j=Buffer.from(JSON.stringify(g));j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]);const tail=b.subarray(20+n),out=Buffer.alloc(20+j.length+tail.length);
 out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(j.length,12);out.writeUInt32LE(0x4e4f534a,16);j.copy(out,20);tail.copy(out,20+j.length);return out.buffer.slice(out.byteOffset,out.byteOffset+out.length);
}
test('real additive bytes retain every original loop body track and exact body skeleton; ordinary old props remain unchanged',async()=>{
 assert.ok(published);const spec=published!;assert.equal(publishedGuardWatch(spec.residentId),spec);assert.equal(publishedGuardWatch('ealdholt-archer'),null);
 for(const [path,sha]of Object.entries(spec.sources))assert.equal(digest(pinned(path)),sha);
 const {GLTFLoader}=await import(new URL('../../main game/node_modules/three/examples/jsm/loaders/GLTFLoader.js',import.meta.url).href);
 (globalThis as any).self=globalThis;const loader=new GLTFLoader(),load=(path:string)=>loader.parseAsync(textureFree(pinned(path)),'');
 const [base,addon,body]=await Promise.all([load('crowd-v1/clips/crowd-clips-adult-male-v1.glb'),load(spec.file),load(`crowd-v1/residents/${spec.residentId}.glb`)]);
 const joined=prepareGuardWatchLibrary(prepareCrowdLibrary(base),prepareCrowdLibrary(addon));assert.equal(joined.names.size,base.animations.length+2);
 for(const original of base.animations){const merged=joined.clip(original.name);for(let i=0;i<original.tracks.length;i++){
  assert.equal(merged.tracks[i].name,original.tracks[i].name);assert.deepEqual(merged.tracks[i].times,original.tracks[i].times);assert.deepEqual(merged.tracks[i].values,original.tracks[i].values);
  assert.equal(merged.tracks[i].getInterpolation(),original.tracks[i].getInterpolation());}
  assert.equal(merged.tracks.length,original.tracks.length+([LOOP,WALK].includes(original.name)?3:0));}
 const bound=bindCrowdTemplate(body,joined,true);assert.ok(bound.restDifference.metres<1e-6);assert.equal(body.scene.getObjectsByProperty('name',HELPER).length,1);
 const meta=parseCrowdResidentMeta(JSON.parse(pinned(`crowd-v1/residents/${spec.residentId}.json`).toString())),before=JSON.stringify(meta),derived=guardWatchCrowdMeta(meta);
 const walk=planCrowdClips(meta,joined.names,{roleClip:WALK,guardWatch:true},CODEX_OWNER_MOTIONS.patched);
 const dwell=planCrowdClips(meta,joined.names,{roleClip:LOOP,guardWatch:true},CODEX_OWNER_MOTIONS.patched);assert.equal(walk.key,dwell.key);
 assert.equal(dwell.clips.work,LOOP);assert.equal(dwell.clips.workEnter,ENTER);assert.equal(dwell.clips.workExit,EXIT);
 assert.ok(!Object.values(dwell.clips).includes(LOOP+'_enter'),'the unsafe old transition is retained but never selected');
 const props=planCrowdProps(derived.presentation,dwell);for(const name of ['walk','work','workEnter','workExit'] as const){
  const visible=props.visible[name]!.map(i=>props.attachments[i]);assert.equal(visible.filter(p=>p.prop==='spear').length,1);assert.equal(visible.find(p=>p.prop==='spear')!.bone,HELPER);assert.ok(visible.every(p=>p.bone!==null));}
 const old=planCrowdClips(meta,joined.names,{roleClip:WALK},CODEX_OWNER_MOTIONS.patched),oldProps=planCrowdProps(meta.presentation,old);
 assert.equal(oldProps.attachments.find(p=>p.prop==='spear')!.bone,'hand_r');assert.equal(JSON.stringify(meta),before);
 const unsupported=planCrowdClips(meta,new Set(base.animations.map(a=>a.name)),{roleClip:LOOP,guardWatch:true},CODEX_OWNER_MOTIONS.patched);assert.equal(unsupported.unpresentable,LOOP);
});
test('both actual-platform full-skin/held-spear/fade proofs fit the unchanged capsule; a smaller capsule still holds',()=>{
 const spec=published!,proof=JSON.parse(pinned('crowd-v1/addons/guard-watch-compact-v1/measurement.json').toString());assert.equal(proof.pass,true);
 const site={capsule:{radius:.85,height:3.5}} as VillageSiteLayout;
 for(const profile of ['desktop','quest'] as const){const p=proof.platforms[profile];assert.equal(p.ownerMatrixError,0);assert.ok(p.vertexSamples>20_000_000);assert.ok(p.blendSamples>=5670);
  assert.ok(p.maximumHandGapMetres<.001);assert.ok(p.maximumGripAngleDegrees<.01);assert.ok(p.blends.minimumBodyYMetres>=0);
  assert.ok(p.maximumFootCorrectionMetres>.06&&p.maximumFootCorrectionMetres<.07);
  assert.equal(qualifyGuardWatchMotion(spec.residentId,site,profile).presentable,true);
  assert.equal(qualifyGuardWatchMotion(spec.residentId,{...site,capsule:{radius:.50,height:3.5}},profile).reason,'guard-watch-proxy-budget-exceeded');}
});

test('both real presenter callers retain one spear/actor across walk-watch, ground after mixing, restore without drift and release on hide',async()=>{
 // CPU caller fixture, not an added village placement or a rendered scene.
 const spec=published!,resident=population.residents.find(r=>r.id===spec.residentId)!,position=[0,0,-2] as const;
 for(const platform of ['desktop','quest'] as const){
  const prefix=platform==='desktop'?'main game':'main-game-vr';
  const THREE=await import(new URL('../../'+prefix+'/node_modules/three/build/three.module.js',import.meta.url).href);
  const {GLTFLoader}=await import(new URL('../../'+prefix+'/node_modules/three/examples/jsm/loaders/GLTFLoader.js',import.meta.url).href);
  const adapter=await import(new URL('../../'+prefix+'/src/legacy/aethelgard/characters/crowd-residents.ts',import.meta.url).href);
  const owner=await import(new URL('../../'+prefix+'/src/legacy/aethelgard/resident-actors.ts',import.meta.url).href),loader=new GLTFLoader();
  let loads=0,releases=0,lastOwnerClips:any=null;const read=(url:string,expected:string)=>{const bytes=fs.readFileSync(new URL(url));assert.equal(digest(bytes),expected);return bytes;};
  const parent=new THREE.Group();parent.position.set(7,3,-9);parent.scale.setScalar(.2);parent.rotation.y=.7;
  const presenter=adapter.createCrowdPresenter({root:root.href,parent,integritySha256:hashes,ownerMotions:CODEX_OWNER_MOTIONS.patched,
    maxSetupsPerFrame:1,setupBudgetMilliseconds:1e6,prefetchSets:false,props:true,trustPublishedEnvelopes:true,
    createActors:(template:any,placements:any,options:any)=>{lastOwnerClips=options.clips;return owner.createEaldholtResidentActors(template,placements,options);},
    loader:{loadGltf:async()=>{throw Error('Unverified load is forbidden.');},loadJson:async()=>{throw Error('Unverified metadata is forbidden.');},
      loadVerifiedJson:async(url:string,hash:string)=>JSON.parse(read(url,hash).toString()),
      loadVerifiedGltf:async(url:string,hash:string)=>{loads++;return loader.parseAsync(textureFree(read(url,hash)),'');},
      releaseGltf:(_url:string,gltf:any)=>{releases++;adapter.disposeCrowdGltf(gltf);}},onError:(_id:string,error:unknown)=>{throw error;}});
  const requests=[{residentId:spec.residentId,tier:resident.fidelityTier,position,heightMetres:1.8,presentable:true,moving:false,interaction:'none' as const,current:null}];
  const presencePlatform=platform==='desktop'?'desktop-isometric':'quest';
  const selection=selectVillagePresence({platform:presencePlatform,position:[0,1.6,0],forward:[0,-1],halfFovDegrees:52,pixelsPerDegree:25},requests);
  presenter.sync(selection,new Map([[spec.residentId,{roleClip:WALK,guardWatch:true}]]));await presenter.settled();presenter.prepare();
  const actorSet=presenter.actorsFor(spec.residentId)!;assert.ok(actorSet);
  const states=new Map([[spec.residentId,{residentId:spec.residentId,motion:'walk',position,yawRadians:0,animationTimeSeconds:.25,fadeSeconds:0}]]);
  const frame:any={clockSeconds:0,paused:false,reducedMotion:false,residents:states};presenter.update(0,frame);
  assert.equal(actorSet.actors[0].activeMotion,'walk');
  presenter.sync(selection,new Map([[spec.residentId,{roleClip:LOOP,guardWatch:true}]]));assert.equal(presenter.actorsFor(spec.residentId),actorSet,'both phases keep one clip plan/actor');
  states.set(spec.residentId,{residentId:spec.residentId,motion:'workEnter',position,yawRadians:0,animationTimeSeconds:0,fadeSeconds:.12});presenter.update(0,frame);
  states.get(spec.residentId)!.animationTimeSeconds=.06;frame.clockSeconds=.06;presenter.update(.06,frame);
  const actor=actorSet.actors[0],model=actor.model;assert.equal(actor.activeMotion,'workEnter');assert.equal(actorSet.object.visible,true);
  assert.deepEqual(model.parent!.position.toArray(),position);assert.deepEqual(model.position.toArray(),[0,0,0]);
  const helper=model.getObjectByName(HELPER)!;assert.equal(helper.children.filter((n:any)=>n.name==='prop_spear').length,1);
  const inverse=new THREE.Matrix4().copy(model.matrixWorld).invert(),p=new THREE.Vector3();let floor=Infinity;
  model.traverse((mesh:any)=>{if(!mesh.isSkinnedMesh)return;for(let i=0;i<mesh.geometry.attributes.position.count;i++){
    mesh.getVertexPosition(i,p);p.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);floor=Math.min(floor,p.y);}});assert.ok(floor>=-.03);
  // Normal accelerated/catch-up playback may skip phases. Those actual
  // current poses must cut, not start an unmeasured or chained blend.
  states.set(spec.residentId,{residentId:spec.residentId,motion:'work',position,yawRadians:0,animationTimeSeconds:1,fadeSeconds:.12});
  frame.clockSeconds=2;presenter.update(.1,frame);assert.equal(actor.activeMotion,'work');assert.equal(actor.fadingFrom,null);assert.equal(actorSet.object.visible,true);
  presenter.sync(selection,new Map([[spec.residentId,{roleClip:WALK,guardWatch:true}]]));
  states.set(spec.residentId,{residentId:spec.residentId,motion:'walk',position,yawRadians:0,animationTimeSeconds:0,fadeSeconds:.12});
  presenter.update(.1,frame);assert.equal(actor.activeMotion,'walk');assert.equal(actor.fadingFrom,null);assert.equal(presenter.actorsFor(spec.residentId),actorSet);
  frame.paused=true;const matrices=()=>['foot_l','foot_r',HELPER].flatMap(name=>model.getObjectByName(name)!.matrixWorld.toArray());
  presenter.update(0,frame);const frozen=matrices();for(let n=0;n<8;n++)presenter.update(0,frame);
  assert.ok(matrices().every((v,i)=>Math.abs(v-frozen[i])<1e-9),'post-mixer correction cannot accumulate through pause/cached poses');
  presenter.sync(selectVillagePresence({platform:presencePlatform,position:[0,1.6,0],forward:[0,-1],halfFovDegrees:52,pixelsPerDegree:25},[{...requests[0],presentable:false}]));
  assert.equal(actorSet.disposed,true);assert.equal(presenter.actorsFor(spec.residentId),null);
  // A cold paused view has no previously presented pose. Adopt the genuine
  // current watch immediately; setup idle must never become a frozen fade.
  presenter.sync(selection,new Map([[spec.residentId,{roleClip:LOOP,guardWatch:true}]]));await presenter.settled();presenter.prepare();
  states.set(spec.residentId,{residentId:spec.residentId,motion:'work',position,yawRadians:0,animationTimeSeconds:1,fadeSeconds:.12});
  presenter.update(0,frame);const cold=presenter.actorsFor(spec.residentId)!;assert.equal(cold.object.visible,true);
  assert.equal(cold.actors[0].activeMotion,'work');assert.equal(cold.actors[0].fadingFrom,null);
  presenter.sync(selectVillagePresence({platform:presencePlatform,position:[0,1.6,0],forward:[0,-1],halfFovDegrees:52,pixelsPerDegree:25},[{...requests[0],presentable:false}]));
  presenter.sync(selection,new Map([[spec.residentId,{roleClip:LOOP,guardWatch:true}]]));await presenter.settled();presenter.prepare();
  frame.reducedMotion=true;presenter.update(0,frame);
  const reduced=presenter.actorsFor(spec.residentId)!,reducedActor=reduced.actors[0],reducedModel=reducedActor.model;
  assert.equal(reduced.object.visible,true);assert.equal(reducedActor.activeMotion,'work');assert.equal(reducedActor.fadingFrom,null);
  assert.equal(lastOwnerClips.work.name,presenter.planFor(spec.residentId)!.clips.work);
  const evaluatedTime=reducedActor.mixer!.existingAction(lastOwnerClips.work)!.time;
  assert.ok(Number.isFinite(evaluatedTime)&&evaluatedTime>=0&&evaluatedTime<=9,'comfort mode uses an actually evaluated published-role phase; no requested-phase equality is claimed');
  assert.deepEqual(reducedModel.parent!.position.toArray(),position);assert.deepEqual(reducedModel.position.toArray(),[0,0,0]);
  const reducedHelper=reducedModel.getObjectByName(HELPER)!;assert.equal(reducedHelper.children.filter((n:any)=>n.name==='prop_spear'&&n.visible).length,1);
  const reducedInverse=new THREE.Matrix4().copy(reducedModel.matrixWorld).invert();let reducedFloor=Infinity;
  reducedModel.traverse((mesh:any)=>{if(!mesh.isSkinnedMesh)return;for(let i=0;i<mesh.geometry.attributes.position.count;i++){
    mesh.getVertexPosition(i,p);p.applyMatrix4(mesh.matrixWorld).applyMatrix4(reducedInverse);reducedFloor=Math.min(reducedFloor,p.y);}});assert.ok(reducedFloor>=-.03);
  const reducedMatrices=()=>['foot_l','foot_r',HELPER].flatMap(name=>reducedModel.getObjectByName(name)!.matrixWorld.toArray());
  const held=reducedMatrices();for(let n=0;n<8;n++){frame.clockSeconds++;presenter.update(0,frame);}
  assert.ok(reducedMatrices().every((v,i)=>Math.abs(v-held[i])<1e-9),'cold paused reduced-motion pose remains grounded/stable');
  presenter.dispose();assert.equal(releases,loads);
 }
});
