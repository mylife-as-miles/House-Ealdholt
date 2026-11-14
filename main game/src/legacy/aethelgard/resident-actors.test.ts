import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationClip, Bone, Box3, BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh,
  MeshStandardMaterial, PerspectiveCamera, NumberKeyframeTrack, Quaternion, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Texture,
  Uint16BufferAttribute, Vector3, VectorKeyframeTrack } from 'three';
import { createEaldholtResidentActors, type EaldholtResidentFrame, type EaldholtResidentMotion } from './resident-actors';

function fixture() {
  const scene = new Group(), model = new Group(); scene.name = 'Template scene'; model.name = 'Adult'; scene.add(model);
  const root = new Bone(), pelvis = new Bone(); root.name = 'root'; pelvis.name = 'pelvis'; pelvis.position.y = 1; root.add(pelvis); model.add(root);
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute([-.2,0,0,.2,0,0,0,1,0],3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4)); geometry.setIndex([0,1,2]);
  const texture = new Texture(), material = new MeshStandardMaterial({map:texture}); scene.updateMatrixWorld(true);
  const skeleton = new Skeleton([root,pelvis]), clothing = new SkinnedMesh(geometry,material), head = new SkinnedMesh(geometry,material);
  clothing.name = 'Clothing'; head.name = 'Head'; model.add(clothing,head); clothing.bind(skeleton,new Matrix4()); head.bind(skeleton,new Matrix4());
  const staticGeometry = new BufferGeometry(); staticGeometry.setAttribute('position',new Float32BufferAttribute([2,0,0,3,0,0,2,1,0],3));
  const attached = new Mesh(staticGeometry,material); attached.name = 'Attached support'; model.add(attached);
  const idle = new AnimationClip('Qualified neutral',1,[new VectorKeyframeTrack('pelvis.position',[0,.5,1],[0,1,0,0,1.4,0,0,1,0])]);
  const talk = new AnimationClip('Qualified talking',1,[new VectorKeyframeTrack('Adult.position',[0,.5,1],[0,0,0,2,0,0,0,0,0])]);
  const template = {scene,animations:[idle,talk]}; let borrowedDisposals = 0;
  skeleton.computeBoneTexture();
  for(const resource of [geometry,staticGeometry,material,texture,skeleton.boneTexture!]) resource.addEventListener('dispose',()=>borrowedDisposals++);
  return {template,model,root,pelvis,geometry,staticGeometry,material,texture,skeleton,clothing,head,idle,talk,
    borrowed:()=>borrowedDisposals, cleanup(){skeleton.dispose();geometry.dispose();staticGeometry.dispose();material.dispose();texture.dispose();}};
}
const placements = [{residentId:'resident-a',position:[4,0,2]as const,yawRadians:0,phaseSeconds:0},
  {residentId:'resident-b',position:[-4,0,-2]as const,yawRadians:.5,phaseSeconds:.25}];
function frame(motion:EaldholtResidentMotion='idle',extra:Partial<EaldholtResidentFrame>={}):EaldholtResidentFrame {
  return {clockSeconds:1,paused:false,reducedMotion:false,residents:placements.map(p=>({residentId:p.residentId,motion})),...extra};
}
function skin(model:Group|ReturnType<typeof createEaldholtResidentActors>['actors'][number]['model']) { return model.getObjectByName('Clothing')as SkinnedMesh; }

test('residents remap independent bones/skeletons while sharing immutable geometry, materials, clips and intra-actor rig',()=>{
  const f=fixture(),positions=Array.from(f.geometry.getAttribute('position').array),clipValues=Array.from(f.idle.tracks[0].values);
  const handle=createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle,talk:f.talk}}),a=handle.actors[0],b=handle.actors[1],sa=skin(a.model),sb=skin(b.model);
  assert.notEqual(sa.skeleton,sb.skeleton);assert.notEqual(sa.skeleton,f.skeleton);assert.equal(sa.skeleton,(a.model.getObjectByName('Head')as SkinnedMesh).skeleton);
  assert.notEqual(sa.skeleton.bones[1],f.pelvis);assert.notEqual(sa.skeleton.boneInverses[1],f.skeleton.boneInverses[1]);assert.notEqual(a.mixer,b.mixer);
  assert.equal(sa.geometry,f.geometry);assert.equal(sa.material,f.material);assert.equal(sa.skeleton.boneTexture,null);assert.equal(f.skeleton.boneTexture?.image.width,4);
  handle.update(.125,frame());assert.notEqual(sa.skeleton.bones[1].position.y,sb.skeleton.bones[1].position.y);assert.equal(f.pelvis.position.y,1);
  assert.deepEqual(Array.from(f.geometry.getAttribute('position').array),positions);assert.deepEqual(Array.from(f.idle.tracks[0].values),clipValues);assert.equal(f.geometry.boundingBox,null);
  handle.dispose();assert.equal(f.borrowed(),0);f.cleanup();
});

test('inner root tracks cannot overwrite outer explicit placement; complete animated bounds include every actor/support',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle,talk:f.talk}});
  handle.update(.5,frame('talk'));assert.deepEqual(handle.actors[0].placement.position.toArray(),[4,0,2]);
  assert.equal(handle.actors[0].model.getObjectByName('Adult')!.position.x,2);assert.deepEqual(f.model.position.toArray(),[0,0,0]);
  assert.ok(handle.bounds.max.x>=9);assert.ok(handle.bounds.min.x<-3);assert.equal(handle.metrics.actors,2);assert.equal(handle.metrics.skeletons,2);
  assert.equal(handle.metrics.verticesPerActor,9);assert.equal(handle.metrics.frustumCulling,'disabled-conservative');assert.ok(handle.metrics.envelopeSamples>=10);
  for(const actor of handle.actors)assert.ok(handle.bounds.containsBox(actor.bounds));handle.dispose();f.cleanup();
});

test('updates reuse envelopes without vertex bounds scans or borrowed geometry bounds mutation',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle,talk:f.talk}}),dto=frame();
  for(const actor of handle.actors){skin(actor.model).computeBoundingBox=()=>{throw Error('per-frame skin scan');};assert.equal(skin(actor.model).frustumCulled,false);}
  const bounds=handle.bounds;for(let i=0;i<30;i++)handle.update(.01,dto);handle.update(0,frame('talk'));
  assert.equal(handle.bounds,bounds);assert.equal(handle.metrics.perFrameVertexScans,0);assert.equal(f.geometry.boundingBox,null);assert.equal(f.staticGeometry.boundingBox,null);
  handle.dispose();assert.equal(f.borrowed(),0);f.cleanup();
});

test('missing walking/sitting remains explicit unsupported neutral fallback, never talking as work',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle,talk:f.talk}});
  for(const motion of ['walk','sit']as const){handle.update(.1,frame(motion));for(const actor of handle.actors){assert.equal(actor.requestedMotion,motion);assert.equal(actor.activeMotion,'idle');assert.equal(actor.status,'unavailable-motion');}}
  handle.update(0,frame('talk'));assert.equal(handle.actors[0].activeMotion,'talk');assert.equal(handle.actors[0].status,'ready');
  assert.throws(()=>createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle,talk:f.talk,walk:f.talk}}),/different resident motion/);
  handle.dispose();f.cleanup();
});

test('pause preserves pose/placement; reduced motion freezes mixer and resume consumes no elapsed-clock catch-up',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle,talk:f.talk}}),actor=handle.actors[0];
  handle.update(.1,frame());const before=skin(actor.model).skeleton.bones[1].position.y,time=actor.mixer.time;
  handle.update(1,frame('talk',{clockSeconds:100,paused:true,residents:[{residentId:'resident-a',motion:'talk',position:[99,0,0]},{residentId:'resident-b',motion:'talk'}]}));
  assert.equal(actor.mixer.time,time);assert.equal(actor.activeMotion,'idle');assert.equal(actor.placement.position.x,4);assert.equal(skin(actor.model).skeleton.bones[1].position.y,before);
  handle.update(1,frame('idle',{clockSeconds:200,reducedMotion:true}));assert.equal(actor.mixer.time,time);
  handle.update(.125,frame('idle',{clockSeconds:500}));assert.equal(actor.mixer.time,time+.125);assert.equal(handle.clockSeconds,500);
  handle.dispose();f.cleanup();
});

test('owned bone textures and mixer caches release once; source and foreign materials/skeleton survive',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle}}),scene=new Group();scene.add(handle.object);
  let owned=0,foreign=0;const foreignMaterial=new MeshStandardMaterial(),foreignSkeleton=new Skeleton([new Bone()]);foreignSkeleton.computeBoneTexture();
  foreignMaterial.addEventListener('dispose',()=>foreign++);foreignSkeleton.boneTexture!.addEventListener('dispose',()=>foreign++);
  for(const actor of handle.actors){const skeleton=skin(actor.model).skeleton;skeleton.computeBoneTexture();skeleton.boneTexture!.addEventListener('dispose',()=>owned++);}
  skin(handle.actors[0].model).material=foreignMaterial;skin(handle.actors[0].model).skeleton=foreignSkeleton;
  handle.dispose();handle.dispose();handle.update(.1,frame());assert.equal(owned,2);assert.equal(f.borrowed(),0);assert.equal(foreign,0);assert.equal(handle.object.parent,null);
  for(const actor of handle.actors){assert.equal(actor.mixer.stats.actions.inUse,0);assert.equal(actor.mixer.stats.bindings.total,0);}
  foreignMaterial.dispose();foreignSkeleton.dispose();f.cleanup();
});

test('invalid/partial/duplicate frame states fail before any placement or pose mutation',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle}}),before=handle.actors[0].placement.position.clone();
  const bad=frame('idle',{residents:[{residentId:'resident-a',motion:'idle',position:[88,0,0]},{residentId:'missing',motion:'idle'}]});
  assert.throws(()=>handle.update(.1,bad),/unknown, duplicate/);assert.ok(handle.actors[0].placement.position.equals(before));
  assert.throws(()=>handle.update(2,frame()),/0..1 seconds/);assert.throws(()=>handle.update(.1,frame('idle',{residents:[]})),/complete explicit/);
  assert.throws(()=>handle.update(.1,frame('idle',{residents:[{residentId:'resident-a',motion:'idle'},{residentId:'resident-a',motion:'idle'}]})),/duplicate/);
  handle.update(.1,frame());handle.dispose();f.cleanup();
});

test('unregistered, material, ambiguous and UUID track targets cannot mutate borrowed data',()=>{
  const f=fixture(),outside=new AnimationClip('outside',1,[new VectorKeyframeTrack('pelvis.position',[0,1],[0,1,0,0,1,0])]);
  assert.throws(()=>createEaldholtResidentActors(f.template,placements,{clips:{idle:outside}}),/already loaded template/);
  for(const path of ['Clothing.material.opacity','missing.position',f.pelvis.uuid+'.position']){
    const clip=new AnimationClip('invalid',1,[new VectorKeyframeTrack(path,[0,1],[0,0,0,1,1,1])]);f.template.animations.push(clip);
    assert.throws(()=>createEaldholtResidentActors(f.template,placements,{clips:{idle:clip}}),/transforms only|stable node name/);
  }
  const duplicate=new Bone();duplicate.name='pelvis';f.model.add(duplicate);
  assert.throws(()=>createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle}}),/ambiguous/);assert.equal(f.borrowed(),0);f.cleanup();
});

test('missing external bones, nonfinite vertices and invalid skin weights reject cleanly without source disposal',()=>{
  for(const fault of ['external','nonfinite','weights','inverse']as const){
    const f=fixture();if(fault==='external')f.skeleton.bones[1]=new Bone();
    if(fault==='nonfinite')f.geometry.getAttribute('position').setX(0,NaN);
    if(fault==='weights')f.geometry.getAttribute('skinWeight').setX(0,.5);
    if(fault==='inverse')f.skeleton.boneInverses.pop();
    assert.throws(()=>createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle}}),/outside|nonfinite|sum to one|inverse bind/);assert.equal(f.borrowed(),0);f.cleanup();
  }
});

test('callbacks remain intact and analytic interpolation padding contains actual intermediate deformed support',()=>{
  const f=fixture();let callbacks=0;f.clothing.onBeforeRender=()=>{callbacks++;};
  const end=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),1.2),rotation=new AnimationClip('Qualified rotation',1,[new QuaternionKeyframeTrack('pelvis.quaternion',[0,1],[0,0,0,1,...end.toArray()])]);
  f.template.animations.push(rotation);const handle=createEaldholtResidentActors(f.template,[placements[0]],{clips:{idle:rotation}}),actor=handle.actors[0],mesh=skin(actor.model);
  assert.equal(mesh.onBeforeRender,f.clothing.onBeforeRender);mesh.onBeforeRender(null as never,null as never,null as never,null as never,null as never,null as never);assert.equal(callbacks,1);
  assert.ok(handle.metrics.envelopePaddingMetres>0);
  for(const t of [.123,.371,.829]){
    actor.mixer.setTime(t);handle.object.updateMatrixWorld(true);mesh.skeleton.update();mesh.computeBoundingBox();
    const box=new Box3().copy(mesh.boundingBox!).applyMatrix4(mesh.matrixWorld);assert.ok(handle.bounds.containsBox(box));
  }
  handle.dispose();assert.equal(f.borrowed(),0);f.cleanup();
});

test('empty placements create no anonymous residents and malformed clips/transforms stay unsupported',()=>{
  const f=fixture(),empty=createEaldholtResidentActors(f.template,[],{clips:{idle:f.idle}});assert.equal(empty.actors.length,0);assert.equal(empty.object.children.length,0);empty.dispose();
  assert.throws(()=>createEaldholtResidentActors(f.template,[{...placements[0],scale:0}],{clips:{idle:f.idle}}),/positive-scale/);
  for(const residentId of [' invalid ', 'x'.repeat(257), 'invalid\nidentifier'])
    assert.throws(()=>createEaldholtResidentActors(f.template,[{...placements[0],residentId}],{clips:{idle:f.idle}}),/distinct IDs/);
  const bad=new AnimationClip('bad dimensions',1,[new NumberKeyframeTrack('pelvis.position',[0,1],[0,1])]);f.template.animations.push(bad);
  assert.throws(()=>createEaldholtResidentActors(f.template,placements,{clips:{idle:bad}}),/dimensions/);assert.equal(f.borrowed(),0);f.cleanup();
});


test('explicit clip phase follows caller distance timing independently of frame delta or placement phase',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle}});
  const phase=(seconds:number)=>frame('idle',{residents:placements.map(p=>({residentId:p.residentId,motion:'idle',animationTimeSeconds:seconds}))});
  handle.update(.8,phase(.125));
  for(const actor of handle.actors)assert.ok(Math.abs(skin(actor.model).skeleton.bones[1].position.y-1.1)<1e-6);
  const before=handle.actors.map(actor=>skin(actor.model).skeleton.bones[1].position.y);
  handle.update(0,phase(10.125));
  assert.deepEqual(handle.actors.map(actor=>skin(actor.model).skeleton.bones[1].position.y),before);
  handle.update(.4,{...phase(.375),paused:true});
  handle.update(.4,{...phase(.375),reducedMotion:true});
  assert.deepEqual(handle.actors.map(actor=>skin(actor.model).skeleton.bones[1].position.y),before);
  handle.update(0,phase(.375));
  for(const actor of handle.actors)assert.ok(Math.abs(skin(actor.model).skeleton.bones[1].position.y-1.3)<1e-6);
  assert.deepEqual(handle.actors[0].placement.position.toArray(),placements[0].position);
  assert.equal(f.pelvis.position.y,1);handle.dispose();assert.equal(f.borrowed(),0);f.cleanup();
});

test('unsupported motions ignore their phase and invalid later-actor phase rejects the whole frame',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle}});
  handle.update(0,frame('walk',{residents:placements.map(p=>({residentId:p.residentId,motion:'walk',animationTimeSeconds:.5}))}));
  assert.equal(handle.actors[0].activeMotion,'idle');assert.equal(handle.actors[0].status,'unavailable-motion');
  assert.equal(skin(handle.actors[0].model).skeleton.bones[1].position.y,1);
  const poses=handle.actors.map(actor=>skin(actor.model).skeleton.bones[1].position.y);
  for(const bad of [NaN,Infinity,-.1]){
    assert.throws(()=>handle.update(.1,frame('idle',{residents:[
      {residentId:'resident-a',motion:'idle',position:[88,0,0],animationTimeSeconds:.5},
      {residentId:'resident-b',motion:'idle',animationTimeSeconds:bad},
    ]})),/invalid actor state/);
    assert.deepEqual(handle.actors[0].placement.position.toArray(),placements[0].position);
    assert.deepEqual(handle.actors.map(actor=>skin(actor.model).skeleton.bones[1].position.y),poses);
  }
  handle.dispose();f.cleanup();
});


test('animated common-parent transforms use renderer skin bind inverses in cached bounds',()=>{
  const f=fixture();f.model.remove(f.model.getObjectByName('Attached support')!);
  const position=[3,2,4],scale=[1.2,.8,1.1],q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.7);
  const clip=new AnimationClip('Common parent TRS',1,[
    new VectorKeyframeTrack('Adult.position',[0,1],[...position,...position]),
    new VectorKeyframeTrack('Adult.scale',[0,1],[...scale,...scale]),
    new QuaternionKeyframeTrack('Adult.quaternion',[0,1],[...q.toArray(),...q.toArray()]),
  ]);f.template.animations.push(clip);
  const handle=createEaldholtResidentActors(f.template,[{residentId:'resident-a',position:[0,0,0],yawRadians:0}],{clips:{idle:clip}});
  const transform=new Matrix4().compose(new Vector3().fromArray(position),q,new Vector3().fromArray(scale));
  const expected=new Box3(),point=new Vector3(),vertices=f.geometry.getAttribute('position');
  for(let i=0;i<vertices.count;i++)expected.expandByPoint(point.fromBufferAttribute(vertices,i).applyMatrix4(transform));
  assert.ok(handle.bounds.min.distanceTo(expected.min)<.0001);
  assert.ok(handle.bounds.max.distanceTo(expected.max)<.0001);
  handle.object.updateMatrixWorld(true);const mesh=skin(handle.actors[0].model);mesh.skeleton.update();
  for(let i=0;i<vertices.count;i++){
    mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);
    assert.ok(handle.bounds.containsPoint(point));
  }
  assert.deepEqual(f.model.position.toArray(),[0,0,0]);assert.deepEqual(f.model.scale.toArray(),[1,1,1]);
  handle.dispose();assert.equal(f.borrowed(),0);f.cleanup();
});

test('mixed resident cadences skip mixer work while preserving identities, transforms and pose agreement',()=>{
  const f=fixture(),ps=[...placements,{residentId:'resident-c',position:[0,0,0]as const,yawRadians:0}],
    handle=createEaldholtResidentActors(f.template,ps,{clips:{idle:f.idle}}),
    control=createEaldholtResidentActors(f.template,ps,{clips:{idle:f.idle}}),calls=[0,0,0];
  handle.actors.forEach((actor,i)=>{const update=actor.mixer.update.bind(actor.mixer);actor.mixer.update=dt=>{calls[i]++;return update(dt);};});
  let elapsed=0;
  for(const dt of [.1,.12,.03,.08,.17,.03]){
    elapsed+=dt;const prior=calls[1],states=ps.map((p,i)=>({residentId:p.residentId,motion:'idle'as const,
      position:[i*2+elapsed,0,0]as const,yawRadians:elapsed}));
    control.update(dt,frame('idle',{residents:states}));
    handle.update(dt,frame('idle',{residents:states.map((state,i)=>({...state,animationUpdateIntervalSeconds:i===0?0:i===1?.25:null}))}));
    for(const [i,actor]of handle.actors.entries()){
      assert.ok(Math.abs(actor.placement.position.x-(i*2+elapsed))<1e-10);
      assert.equal(actor.placement.rotation.y,elapsed);assert.equal(actor.placement.visible,true);
      assert.ok(handle.bounds.containsBox(actor.bounds));
    }
    if(calls[1]!==prior)assert.ok(Math.abs(skin(handle.actors[1].model).skeleton.bones[1].position.y-skin(control.actors[1].model).skeleton.bones[1].position.y)<1e-6);
  }
  assert.deepEqual(calls,[6,2,0]);assert.equal(handle.object.children.length,3);
  assert.equal(skin(handle.actors[2].model).skeleton.bones[1].position.y,1);
  handle.dispose();control.dispose();assert.equal(f.borrowed(),0);f.cleanup();
});

test('suspension retains the latest explicit phase and omission resumes delta time from it',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,[placements[0]],{clips:{idle:f.idle}}),actor=handle.actors[0];
  const step=(dt:number,interval:number|null,phase?:number)=>handle.update(dt,frame('idle',{residents:[{
    residentId:actor.residentId,motion:'idle',animationUpdateIntervalSeconds:interval,animationTimeSeconds:phase}]}));
  step(.1,0);const initial=skin(actor.model).skeleton.bones[1].position.y;
  step(.2,null,.35);step(.1,null,.6);step(.07,null);
  assert.equal(skin(actor.model).skeleton.bones[1].position.y,initial);
  step(0,.25);assert.ok(Math.abs(skin(actor.model).skeleton.bones[1].position.y-1.264)<1e-6);
  step(.15,null);step(0,0);assert.ok(Math.abs(skin(actor.model).skeleton.bones[1].position.y-1.144)<1e-6);
  handle.dispose();f.cleanup();
});

test('explicit phases received at positive cadence override pending delta exactly once',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,[placements[0]],{clips:{idle:f.idle}}),actor=handle.actors[0];
  const step=(dt:number,phase?:number)=>handle.update(dt,frame('idle',{residents:[{
    residentId:actor.residentId,motion:'idle',animationUpdateIntervalSeconds:.3,animationTimeSeconds:phase}]}));
  step(.1,.2);step(.1,.7);step(.1);
  assert.ok(Math.abs(skin(actor.model).skeleton.bones[1].position.y-1.16)<1e-6);
  step(.1);step(.1);step(.1);assert.ok(Math.abs(skin(actor.model).skeleton.bones[1].position.y-1.08)<1e-6);
  handle.dispose();f.cleanup();
});

test('deferred motion changes retain the actually rendered envelope until evaluation',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,[placements[0]],{clips:{idle:f.idle,talk:f.talk}}),actor=handle.actors[0];
  const step=(motion:EaldholtResidentMotion,interval:number|null,phase?:number)=>handle.update(0,frame(motion,{residents:[{
    residentId:actor.residentId,motion,position:[10,0,0],animationTimeSeconds:phase,animationUpdateIntervalSeconds:interval}]}));
  const containsVisible=()=>{
    handle.object.updateMatrixWorld(true);const mesh=skin(actor.model),point=new Vector3();mesh.skeleton.update();
    for(let i=0;i<mesh.geometry.getAttribute('position').count;i++){
      mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);assert.ok(actor.bounds.containsPoint(point));
    }
  };
  step('talk',0,.5);assert.equal(actor.model.getObjectByName('Adult')!.position.x,2);
  const before=actor.bounds.clone();let calls=0;const update=actor.mixer.update.bind(actor.mixer);actor.mixer.update=dt=>{calls++;return update(dt);};
  step('idle',null,.3);assert.equal(calls,0);assert.equal(actor.requestedMotion,'idle');assert.equal(actor.activeMotion,'talk');
  assert.equal(actor.model.getObjectByName('Adult')!.position.x,2);assert.ok(actor.bounds.equals(before));containsVisible();
  step('idle',.25);assert.equal(calls,1);assert.equal(actor.activeMotion,'idle');
  assert.equal(actor.model.getObjectByName('Adult')!.position.x,0);containsVisible();
  handle.dispose();f.cleanup();
});

test('a motion changed away and back during suspension restarts its logical phase',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,[placements[0]],{clips:{idle:f.idle,talk:f.talk}}),actor=handle.actors[0];
  const step=(dt:number,motion:EaldholtResidentMotion,interval:number|null)=>handle.update(dt,frame(motion,{residents:[{
    residentId:actor.residentId,motion,animationUpdateIntervalSeconds:interval}]}));
  step(.125,'idle',0);step(.2,'talk',null);step(.1,'idle',null);
  assert.ok(Math.abs(skin(actor.model).skeleton.bones[1].position.y-1.1)<1e-6);
  step(0,'idle',0);assert.ok(Math.abs(skin(actor.model).skeleton.bones[1].position.y-1.08)<1e-6);
  handle.dispose();f.cleanup();
});

test('pause and reduced motion discard their delta and phase without losing earlier cadence time',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,[placements[0]],{clips:{idle:f.idle}}),actor=handle.actors[0];
  const state={residentId:actor.residentId,motion:'idle'as const,animationUpdateIntervalSeconds:.25};
  handle.update(.1,frame('idle',{residents:[state]}));
  handle.update(1,frame('idle',{clockSeconds:1e9,paused:true,residents:[{...state,position:[99,0,0],animationTimeSeconds:.7}]}));
  assert.equal(actor.placement.position.x,4);
  handle.update(1,frame('idle',{clockSeconds:1e10,reducedMotion:true,residents:[{...state,animationTimeSeconds:.9}]}));
  assert.equal(skin(actor.model).skeleton.bones[1].position.y,1);
  handle.update(.15,frame('idle',{residents:[state]}));
  assert.ok(Math.abs(skin(actor.model).skeleton.bones[1].position.y-1.2)<1e-6);
  handle.dispose();f.cleanup();
});

test('invalid later-actor cadence rejects before latent time or other actors mutate',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle}}),
    control=createEaldholtResidentActors(f.template,placements,{clips:{idle:f.idle}});
  const slow=frame('idle',{residents:placements.map(p=>({residentId:p.residentId,motion:'idle',animationUpdateIntervalSeconds:.25}))});
  handle.update(.1,slow);control.update(.1,slow);
  for(const bad of [NaN,Infinity,-.1,'0',false]){
    assert.throws(()=>handle.update(.1,frame('idle',{residents:[
      {residentId:'resident-a',motion:'idle',position:[88,0,0],animationTimeSeconds:.9},
      {residentId:'resident-b',motion:'idle',animationUpdateIntervalSeconds:bad as number},
    ]})),/invalid actor state/);
    assert.deepEqual(handle.actors[0].placement.position.toArray(),placements[0].position);
  }
  handle.update(.15,slow);control.update(.15,slow);
  for(let i=0;i<placements.length;i++)assert.equal(skin(handle.actors[i].model).skeleton.bones[1].position.y,skin(control.actors[i].model).skeleton.bones[1].position.y);
  handle.dispose();control.dispose();f.cleanup();
});

test('long suspension and interval promotion preserve looping phase without a mixer catch-up burst',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,[placements[0]],{clips:{idle:f.idle}}),actor=handle.actors[0];
  let calls=0;const update=actor.mixer.update.bind(actor.mixer);actor.mixer.update=dt=>{calls++;assert.ok(dt<=2);return update(dt);};
  const step=(dt:number,interval?:number|null,motion:EaldholtResidentMotion='idle',phase?:number)=>handle.update(dt,frame(motion,{residents:[{
    residentId:actor.residentId,motion,animationUpdateIntervalSeconds:interval,animationTimeSeconds:phase}]}));
  for(let i=0;i<100;i++)step(.9,null);
  assert.equal(calls,0);step(.125,undefined);assert.equal(calls,1);
  assert.ok(Math.abs(skin(actor.model).skeleton.bones[1].position.y-1.1)<1e-6);
  step(.1,.4);assert.equal(calls,1);step(0,.2);assert.equal(calls,2);
  const held=skin(actor.model).skeleton.bones[1].position.y;
  step(.2,null,'walk',.9);assert.equal(calls,2);assert.equal(actor.status,'unavailable-motion');
  step(0,0,'walk',.8);assert.equal(calls,2,'a failed request cannot advance the held fallback pose');
  assert.equal(skin(actor.model).skeleton.bones[1].position.y,held);
  handle.dispose();f.cleanup();
});

test('interval remainder avoids repeated evaluations at floating boundaries or zero-delta frames',()=>{
  const f=fixture(),handle=createEaldholtResidentActors(f.template,[placements[0]],{clips:{idle:f.idle}}),actor=handle.actors[0];
  let calls=0;const update=actor.mixer.update.bind(actor.mixer);actor.mixer.update=dt=>{calls++;return update(dt);};
  const step=(dt:number,interval:number)=>handle.update(dt,frame('idle',{residents:[{
    residentId:actor.residentId,motion:'idle',animationUpdateIntervalSeconds:interval}]}));
  step(.1,.3);step(.1,.3);step(.1-1e-14,.3);assert.equal(calls,1);
  step(0,.3);step(0,.3);assert.equal(calls,1);step(.3,.3);assert.equal(calls,2);
  step(0,Number.MIN_VALUE);assert.equal(calls,2);step(.01,Number.MIN_VALUE);assert.equal(calls,3);
  assert.ok(Number.isFinite(skin(actor.model).skeleton.bones[1].position.y));
  handle.dispose();f.cleanup();
});


test('only a cloned skinned-body submission records a drawn frame; selection and pose updates do not', () => {
  const f = fixture(); let inheritedCalls = 0;
  const inherited = () => { inheritedCalls++; }; f.clothing.onAfterRender = inherited;
  const handle = createEaldholtResidentActors(f.template, [placements[0]], { clips: { idle: f.idle } });
  const actor = handle.actors[0], camera = new PerspectiveCamera(), mesh = skin(actor.model);
  try {
    assert.equal(actor.lastRenderedFrame, null);
    handle.update(0, { clockSeconds: 1, paused: false, reducedMotion: false, residents: [{ residentId: actor.residentId, motion: 'idle', position: [8, 0, 3] }] });
    assert.equal(actor.lastRenderedFrame, null, 'a ready pose or selected body is not a submitted draw');
    mesh.onAfterRender({ info: { render: { frame: 7 } } } as never, null as never, camera, mesh.geometry, f.material, null as never);
    assert.equal(inheritedCalls, 1); assert.equal(actor.lastRenderedFrame, 7); assert.equal(actor.lastRenderedCamera, camera);
    assert.deepEqual(actor.lastRenderedPosition, [8, 0, 3]); assert.equal(actor.lastRenderedMotion, 'idle');
    handle.update(0, { clockSeconds: 2, paused: true, reducedMotion: true, residents: [{ residentId: actor.residentId, motion: 'idle', position: [9, 0, 3] }] });
    assert.equal(actor.lastRenderedFrame, 7); assert.deepEqual(actor.lastRenderedPosition, [8, 0, 3], 'an undrawn update cannot replace observed draw coordinates');
    assert.equal(f.clothing.onAfterRender, inherited, 'the source callback is never replaced');
    assert.equal(f.borrowed(), 0);
  } finally { handle.dispose(); assert.equal(actor.lastRenderedFrame, null); assert.equal(actor.lastRenderedCamera, null); f.cleanup(); }
});
