import assert from 'node:assert/strict';
import test from 'node:test';
import {Box3, BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector3, type WebGLRenderer} from 'three';
import {createAuthoredArchitectureSuffixVisibility} from './architecture-suffix-visibility';
import {collectVoxelRegionSource} from './voxel-source';
import {collectRegionalVillageSource} from './regional-village-source';
import {applyEaldholtNeutralFill} from './neutral-fill';
const hash = '3b02834505642a5a9e7535e92812df8e565b99005e9921d41be83be4f5da3b28';

/** Bounds/count fixture only: no source GLB, rendered world or visual proof. */
function fixture() {
  const scene = new Scene(), root = new Group(), geometry = new BufferGeometry(), material = new MeshStandardMaterial();
  const p = new Float32Array(10450 * 3); p.set([-.25,-.25,0,.25,-.25,0,0,.25,0]);
  geometry.setAttribute('position', new BufferAttribute(p, 3));
  const indices = new Uint16Array(53343); indices.set([0,1,2]); geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.boundingBox = new Box3(new Vector3(-.32301,-.60748,-2.88656),new Vector3(.32301,.60518,1.03512));
  const source = new InstancedMesh(geometry, material, 16); source.name = 'duvar_cell_-1_0'; source.userData.crownfallElderbloom = {kind:'architecture'};
  for(let id=0;id<16;id++)source.setMatrixAt(id,new Matrix4().makeTranslation(id<12?0:1000+id*3,0,0));
  const child = new Mesh(new PlaneGeometry(1,1),material); child.name='ordinary repaired source child'; child.userData.crownfallElderbloom={kind:'architecture'};source.add(child);root.add(source);scene.add(root);
  const ground=new Mesh(new PlaneGeometry(10,10),material);ground.name='LandscapeComponent_0';ground.userData.crownfallElderbloom={kind:'terrain'};root.add(ground);
  const camera=new PerspectiveCamera(64,1.6,.15,11000);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);scene.updateMatrixWorld(true);
  let draw=()=>source.count,target:object|null=null;
  const renderer={render(_scene:object,_camera:object){return draw();},xr:{isPresenting:false},shadowMap:{enabled:false},getRenderTarget(){return target;}};
  const create=(sourceSha256=hash)=>createAuthoredArchitectureSuffixVisibility({sourceRoot:root,sourceSha256,renderer:renderer as unknown as WebGLRenderer,scene,camera});
  return{scene,root,geometry,material,source,child,ground,camera,renderer,create,setDraw(value:()=>number){draw=value;},setTarget(value:object|null){target=value;},
    dispose(){source.dispose();geometry.dispose();child.geometry.dispose();ground.geometry.dispose();material.dispose();}};
}

test('actual adapter omits only trailing off-frustum instances with full bounds and unchanged source arrays/children',()=>{
  const f=fixture(),before=f.source.instanceMatrix.array.slice(),position=f.geometry.getAttribute('position').array.slice(),material=f.source.material,raycast=f.source.raycast,owner=f.create();
  try{
    assert.equal(owner.stats.status,'ready');assert.equal(f.renderer.render(f.scene,f.camera),12);assert.equal(f.source.count,16);
    assert.equal(owner.stats.potentialOmittedTriangles,71124);assert.equal(owner.stats.boundsTests,5);
    assert.deepEqual(f.source.instanceMatrix.array,before);assert.deepEqual(f.geometry.getAttribute('position').array,position);
    assert.strictEqual(f.source.material,material);assert.strictEqual(f.source.children[0],f.child);assert.equal(f.child.visible,true);
    assert.ok(f.source.boundingBox!.max.x>1044);assert.ok(f.source.boundingSphere!.radius>500);
    owner.dispose();assert.equal(f.source.boundingBox,null);assert.equal(f.source.boundingSphere,null);assert.strictEqual(f.source.raycast,raycast);
  }finally{owner.dispose();f.dispose();}
});

test('full voxel/protection authority and real Raycaster instance IDs survive a read during the scoped render',async()=>{
  const f=fixture(),identity={worldRegion:'architecture-unit',sourceSha256:hash,generatorVersion:'unit',backend:'webgl2'};
  const before=await collectVoxelRegionSource(f.root,identity,new AbortController().signal),bounds=collectRegionalVillageSource(f.root).village,owner=f.create();
  let during:ReturnType<typeof collectVoxelRegionSource>|undefined;
  try{
    f.setDraw(()=>{
      assert.equal(f.source.count,12);during=collectVoxelRegionSource(f.root,identity,new AbortController().signal);
      assert.deepEqual(collectRegionalVillageSource(f.root).village,bounds);
      const ray=new Raycaster(new Vector3(1045,0,10),new Vector3(0,0,-1)),hits=ray.intersectObject(f.source,false);
      assert.ok(hits.some(hit=>hit.instanceId===15&&hit.object===f.source));assert.equal(f.source.count,16);
      return f.source.count;
    });
    assert.equal(f.renderer.render(f.scene,f.camera),16);assert.deepEqual((await during!).source,before.source);
    assert.equal(owner.stats.scope!.raycastFallbacks,1);assert.equal(f.source.count,16);assert.equal(owner.stats.potentialOmittedTriangles,0);
  }finally{owner.dispose();f.dispose();}
});

test('rotation and nonuniform display transforms use current conservative world boxes, with no stale suffix on return',()=>{
  const f=fixture(),owner=f.create();
  try{
    assert.equal(f.renderer.render(f.scene,f.camera),12);f.camera.position.x=1045;f.camera.lookAt(1045,0,0);f.camera.updateMatrixWorld(true);
    assert.equal(f.renderer.render(f.scene,f.camera),16);
    f.root.scale.set(2,.5,1);f.root.position.x=17;f.camera.position.set(2107,0,10);f.camera.lookAt(2107,0,0);f.camera.updateMatrixWorld(true);
    assert.equal(f.renderer.render(f.scene,f.camera),16);assert.equal(f.source.count,16);
  }finally{owner.dispose();f.dispose();}
});

test('real unsupported shadow, XR, framebuffer, material and source revisions retain complete source',()=>{
  const f=fixture(),owner=f.create();
  try{
    f.renderer.shadowMap.enabled=true;assert.equal(f.renderer.render(f.scene,f.camera),16);f.renderer.shadowMap.enabled=false;
    f.renderer.xr.isPresenting=true;assert.equal(f.renderer.render(f.scene,f.camera),16);f.renderer.xr.isPresenting=false;
    f.setTarget({});assert.equal(f.renderer.render(f.scene,f.camera),16);f.setTarget(null);
    f.material.displacementMap={}as never;assert.equal(f.renderer.render(f.scene,f.camera),16);f.material.displacementMap=null;
    assert.equal(f.renderer.render(f.scene,f.camera),12);f.source.instanceMatrix.needsUpdate=true;
    assert.equal(f.renderer.render(f.scene,f.camera),16);assert.equal(f.source.count,16);assert.equal(owner.stats.reason,'changed-source-retains-full-rendering');
  }finally{owner.dispose();f.dispose();}
});

test('Native/unverified source identities use an honest full-source adaptation without installing renderer hooks',()=>{
  const f=fixture(),render=f.renderer.render;
  try{for(const source of[undefined,'71ed6b23e363e26369164aec387d68e6178850a861eadd8d9b5482f1e50f8e67']){
    const owner=createAuthoredArchitectureSuffixVisibility({sourceRoot:f.root,sourceSha256:source,renderer:f.renderer as unknown as WebGLRenderer,scene:f.scene,camera:f.camera});
    assert.equal(owner.stats.status,'held');assert.strictEqual(f.renderer.render,render);assert.equal(f.renderer.render(f.scene,f.camera),16);owner.dispose();
  }}finally{f.dispose();}
});

test('new source attributes, replaced matrix storage and unreviewed mesh draw hooks fail closed',()=>{
  for(const change of[(f:ReturnType<typeof fixture>)=>f.geometry.setAttribute('unreviewed',new BufferAttribute(new Float32Array(10450),1)),
    (f:ReturnType<typeof fixture>)=>{f.source.instanceMatrix.array=new Float32Array(f.source.instanceMatrix.array);},
    (f:ReturnType<typeof fixture>)=>{f.source.onBeforeRender=()=>{};}]){
    const f=fixture(),owner=f.create();try{change(f);assert.equal(f.renderer.render(f.scene,f.camera),16);assert.equal(f.source.count,16);}finally{owner.dispose();f.dispose();}
  }
});

test('arbitrary initial/replaced/in-place vertex hooks, material callbacks and shader revisions retain full source',()=>{
  for(const change of[(f:ReturnType<typeof fixture>)=>{const next=new MeshStandardMaterial();next.onBeforeCompile=shader=>{shader.vertexShader+='\n// untrusted gl_InstanceID relocation';};f.source.material=next;},
    (f:ReturnType<typeof fixture>)=>{f.material.onBeforeCompile=shader=>{shader.vertexShader+='\n// untrusted vertex relocation';};},
    (f:ReturnType<typeof fixture>)=>{f.material.onBeforeRender=()=>{};},
    (f:ReturnType<typeof fixture>)=>{f.material.customProgramCacheKey=()=> 'unreviewed-program';},
    (f:ReturnType<typeof fixture>)=>{f.material.needsUpdate=true;},
    (f:ReturnType<typeof fixture>)=>{f.material.defines=undefined;}]){
    const f=fixture(),owner=f.create();try{change(f);assert.equal(f.renderer.render(f.scene,f.camera),16);assert.equal(f.source.count,16);}
    finally{owner.dispose();if(f.source.material!==f.material)(f.source.material as MeshStandardMaterial).dispose();f.dispose();}
  }
  const f=fixture();f.material.onBeforeCompile=shader=>{shader.vertexShader+='\n// already untrusted';};
  const owner=f.create();try{assert.equal(f.renderer.render(f.scene,f.camera),16);}finally{owner.dispose();f.dispose();}
});

test('only neutral fill built around an actually static prior chain remains eligible, without trusting metadata flags',()=>{
  for(const trusted of[true,false]){
    const f=fixture();if(!trusted)f.material.onBeforeCompile=shader=>{shader.vertexShader+='\n// prior vertex deformation';};
    const look=applyEaldholtNeutralFill(f.root),owner=f.create();
    try{
      assert.equal(f.renderer.render(f.scene,f.camera),trusted?12:16);
      if(trusted){const material=f.source.material as MeshStandardMaterial,shader={uniforms:{},fragmentShader:'#include <common>\n#include <lights_fragment_maps>',vertexShader:'// original vertex'};
        material.onBeforeCompile(shader as never,null as never);assert.equal(shader.vertexShader,'// original vertex');assert.match(shader.fragmentShader,/CROWNFALL_IBL_NEUTRAL_FILL/);}
    }finally{owner.dispose();look.dispose();f.dispose();}
  }
});
