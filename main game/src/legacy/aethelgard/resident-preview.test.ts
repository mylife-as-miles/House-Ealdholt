import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationClip, Bone, Box3, BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh,
  MeshStandardMaterial, Skeleton, SkinnedMesh, Texture, Uint16BufferAttribute, Vector3, VectorKeyframeTrack } from 'three';
import type { EaldholtResidentPreviewInput } from '../../../../shared/legacy/aethelgard/resident-preview-input';
import { createEaldholtResidentActors } from './resident-actors';
import { assertEaldholtResidentPreviewContained, createEaldholtStandingResidentPreview,
  ealdholtResidentPreviewSourceBounds } from './resident-preview';

function fixture() {
  const scene = new Group(), bone = new Bone(); bone.name = 'pelvis'; bone.position.y = 1; scene.add(bone);
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0,0,0,0,0,0,0,0,0,0,0,0],4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
  const texture = new Texture(), material = new MeshStandardMaterial({ map: texture }), skeleton = new Skeleton([bone]);
  const mesh = new SkinnedMesh(geometry,material); mesh.name = 'Body'; scene.add(mesh); scene.updateMatrixWorld(true);
  mesh.bind(skeleton,new Matrix4()); skeleton.computeBoneTexture();
  const idle = new AnimationClip('test-neutral',1,[new VectorKeyframeTrack('pelvis.position',[0,.5,1],[0,1,0,0,1.25,0,0,1,0])]);
  const other = idle.clone(); other.name = 'test-unused-walk';
  const template = {scene,animations:[idle,other]};
  const placement = {residentId:'synthetic-reference',position:[2,0,3] as const,yawRadians:.5,scale:1};
  const reference = createEaldholtResidentActors(template,[placement],{clips:{idle}}), bounds=reference.bounds.clone(); reference.dispose();
  const asset = {file:'test.glb',url:'https://example.test/test.glb',sha256:'0'.repeat(64),bytes:28};
  const input: EaldholtResidentPreviewInput = {revision:'synthetic-test',profile:'desktop',source:asset,actor:{...asset,file:'actor.glb'},
    idleClip:idle.name,proofSha256:'1'.repeat(64),position:placement.position,yawRadians:placement.yawRadians,
    idleEnvelope:{min:bounds.min.toArray() as [number,number,number],max:bounds.max.toArray() as [number,number,number]}};
  const counts={geometry:0,material:0,texture:0,skeleton:0};
  geometry.addEventListener('dispose',()=>counts.geometry++); material.addEventListener('dispose',()=>counts.material++);
  texture.addEventListener('dispose',()=>counts.texture++); skeleton.boneTexture!.addEventListener('dispose',()=>counts.skeleton++);
  return {template,input,geometry,material,texture,skeleton,bone,counts};
}

test('one explicit neutral actor retains placement and full idle envelope; reduced motion freezes its pose',()=>{
  const f=fixture(),preview=createEaldholtStandingResidentPreview(f.template,f.input),mesh=preview.object.getObjectByName('Body') as SkinnedMesh;
  assert.equal(preview.object.children.length,1); assert.equal(preview.meshes.size,1);
  assert.deepEqual(preview.object.children[0].position.toArray(),f.input.position);
  preview.update(.25,false);assert.equal(mesh.skeleton.bones[0].position.y,1.125);
  preview.update(.5,true);assert.equal(mesh.skeleton.bones[0].position.y,1.125);
  preview.update(.25,false);assert.equal(mesh.skeleton.bones[0].position.y,1.25);
  assert.deepEqual(preview.bounds.min.toArray(),f.input.idleEnvelope.min);assert.deepEqual(preview.bounds.max.toArray(),f.input.idleEnvelope.max);
  assert.equal(f.bone.position.y,1);assert.deepEqual(f.counts,{geometry:0,material:0,texture:0,skeleton:0});
  preview.dispose();assert.deepEqual(f.counts,{geometry:1,material:1,texture:1,skeleton:1});
});

test('owned clone rig releases before borrowed template resources, exactly once',()=>{
  const f=fixture(),preview=createEaldholtStandingResidentPreview(f.template,f.input),parent=new Group();parent.add(preview.object);
  const skeleton=(preview.object.getObjectByName('Body') as SkinnedMesh).skeleton; skeleton.computeBoneTexture();
  const order:string[]=[];skeleton.boneTexture!.addEventListener('dispose',()=>order.push('clone'));
  f.geometry.addEventListener('dispose',()=>order.push('template'));
  preview.dispose();preview.dispose();preview.update(.1,false);
  assert.deepEqual(order,['clone','template']);assert.equal(preview.disposed,true);assert.equal(preview.object.parent,null);
  assert.deepEqual(f.counts,{geometry:1,material:1,texture:1,skeleton:1});
});

test('proof-envelope or idle-clip mismatch rejects and releases its privately owned template',()=>{
  for(const fault of ['bounds','missing','duplicate']as const){
    const f=fixture();let input=f.input;
    if(fault==='bounds')input={...input,idleEnvelope:{...input.idleEnvelope,min:[-99,0,0]}};
    if(fault==='missing')input={...input,idleClip:'not-present'};
    if(fault==='duplicate')f.template.animations.push(f.template.animations[0].clone());
    assert.throws(()=>createEaldholtStandingResidentPreview(f.template,input),/idle envelope|neutral idle clip/);
    assert.deepEqual(f.counts,{geometry:1,material:1,texture:1,skeleton:1});
  }
});

test('source root must remain unit and complete actor envelope must lie inside original world bounds',()=>{
  const world=new Group(),geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([-5,-2,-5,5,5,5,0,0,0],3));
  const material=new MeshStandardMaterial();world.add(new Mesh(geometry,material));
  const bounds=ealdholtResidentPreviewSourceBounds(world);
  assertEaldholtResidentPreviewContained(bounds,new Box3(new Vector3(-1,0,-1),new Vector3(1,2,1)));
  assert.throws(()=>assertEaldholtResidentPreviewContained(bounds,new Box3(new Vector3(-1,0,-1),new Vector3(6,2,1))),/outside/);
  world.scale.x=2;assert.throws(()=>ealdholtResidentPreviewSourceBounds(world),/unit source root/);
  world.scale.x=1;world.matrixAutoUpdate=false;world.matrix.makeTranslation(5,0,0);
  assert.throws(()=>ealdholtResidentPreviewSourceBounds(world),/unit source matrix/);
  geometry.dispose();material.dispose();
});
