import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferGeometry, DataTexture, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, NoColorSpace, ShaderLib, Texture, Vector3, type Material,
  type WebGLRenderer } from 'three';
import { applyEaldholtPondShore } from './pond-shore';
import { applyEaldholtWaterLook } from './water-look';

function plane(size = 1) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-size,0,-size,-size,0,size,size,0,size,size,0,-size, 0,50,0],3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0,0,0,1,1,1,1,0, 1,1],2)); geometry.setIndex([0,1,2,0,2,3]);
  return geometry;
}
function fixture() {
  const root = new Group(), scene = new Group(); scene.add(root);
  const geometry = plane(), pondMaterial = new MeshPhysicalMaterial({ roughness:.24, ior:1.333 }); pondMaterial.name = 'Crownfall_Pond_Water_Review';
  const normal = new Texture(), base = new Texture(), sky = new Texture(); pondMaterial.normalMap = normal; pondMaterial.map = base; pondMaterial.envMap = sky;
  const pond = new Mesh<BufferGeometry, Material | Material[]>(geometry, pondMaterial); pond.name = 'Verified pond'; root.add(pond);
  const terrainMaterial = new MeshStandardMaterial({ roughness:.85 }), terrain = new Mesh(plane(4), terrainMaterial); terrain.name = 'LandscapeComponent_0'; terrain.position.y = -.05; root.add(terrain);
  const coverMaterial = new MeshStandardMaterial({ alphaTest:.3333 }), cover = new InstancedMesh(plane(.2), coverMaterial,1); cover.name = 'Grass_Clumps_01';
  cover.setMatrixAt(0,new Matrix4().makeTranslation(1.1,.02,0)); root.add(cover);
  cover.userData.crownfallElderbloom = { kind:'groundcover', sourceInstances:1, referenceDetail:true };
  const prop = new Mesh(plane(.2),terrainMaterial); prop.name = 'Timber crate'; root.add(prop);
  const tree = new Mesh(plane(.2),coverMaterial); tree.name = 'SM_BlackAlder_Forest_05'; root.add(tree);
  let borrowed = 0; const resources = [geometry,pondMaterial,normal,base,sky,terrain.geometry,terrainMaterial,cover.geometry,coverMaterial,prop.geometry,tree.geometry];
  for (const value of resources) value.addEventListener('dispose',()=>borrowed++);
  return {root,scene,geometry,pondMaterial,normal,base,sky,pond,terrainMaterial,terrain,coverMaterial,cover,prop,tree,borrowed:()=>borrowed,
    cleanup(){cover.dispose();for(const value of resources)value.dispose();}};
}
function compile(material: MeshStandardMaterial) {
  const source = ShaderLib.physical, shader = { uniforms:{}, vertexShader:source.vertexShader, fragmentShader:source.fragmentShader };
  material.onBeforeCompile(shader as Parameters<MeshStandardMaterial['onBeforeCompile']>[0], {} as WebGLRenderer); return shader;
}

test('source-frame cap, owned field and only nearby role assignments preserve borrowed buffers/maps/props',()=>{
  const f=fixture(), before={positions:Array.from(f.geometry.getAttribute('position').array),uv:Array.from(f.geometry.getAttribute('uv').array),index:Array.from(f.geometry.index!.array)};
  f.root.scale.setScalar(.035);f.root.position.set(3,-1,7);f.root.rotation.set(.55,.3,-.2);
  const handle=applyEaldholtPondShore(f.root), pond=f.pond.material as MeshPhysicalMaterial;
  assert.ok(Math.abs(handle.outline.height)<1e-10);assert.ok(Math.abs(handle.outline.metrics.area-4)<1e-8);
  assert.deepEqual([handle.materialCount,handle.pondMaterials,handle.terrainMaterials,handle.groundcoverMaterials,handle.textureCount,handle.textureBytes,handle.extraDrawCalls,handle.extraTriangles],[3,1,1,1,1,87380,0,0]);
  assert.equal(f.prop.material,f.terrainMaterial);assert.equal(f.tree.material,f.coverMaterial);assert.equal(f.geometry.boundingBox,null);
  assert.deepEqual(Array.from(f.geometry.getAttribute('position').array),before.positions);assert.deepEqual(Array.from(f.geometry.getAttribute('uv').array),before.uv);assert.deepEqual(Array.from(f.geometry.index!.array),before.index);
  assert.equal(pond.map,f.base);assert.equal(pond.normalMap,f.normal);assert.equal(pond.envMap,f.sky);assert.equal(pond.ior,1.333);assert.equal(pond.roughness,.24);
  assert.equal(handle.field.contact.mode,'terrain-contact');assert.equal(handle.field.contact.terrainTriangles,2);
  const shader=compile(pond), field=(shader.uniforms as Record<string,{value:unknown}>).uEaldholtPondShoreField.value as DataTexture;
  assert.equal(field.colorSpace,NoColorSpace);assert.equal(field.flipY,false);assert.equal(field.generateMipmaps,false);assert.equal(field.mipmaps.length,8);assert.equal(field.mipmaps.reduce((n,m)=>n+(m as {data:Uint8Array}).data.byteLength,0),87380);
  assert.equal(shader.fragmentShader.includes('ealdholtShoreTop'),true);assert.equal(shader.fragmentShader.includes('Art-directed diffuse shallow'),true);
  let fieldDisposals=0;field.addEventListener('dispose',()=>fieldDisposals++);handle.dispose();handle.dispose();
  assert.equal(handle.disposed,true);assert.equal(fieldDisposals,1);assert.equal(f.borrowed(),0);assert.equal(f.pond.material,f.pondMaterial);assert.equal(f.terrain.material,f.terrainMaterial);f.cleanup();
});

test('whole-clump alpha uses retained instance origins and preserves higher bank roots instead of cutting stems',()=>{
  const f=fixture(),handle=applyEaldholtPondShore(f.root),shader=compile(f.cover.material as MeshStandardMaterial);
  assert.ok(shader.vertexShader.includes('ealdholtShoreActor = instanceMatrix * ealdholtShoreActor'));
  assert.ok(shader.vertexShader.includes('modelMatrix * ealdholtShoreActor'));
  assert.ok(shader.fragmentShader.includes('ealdholtPondShoreMask(vEaldholtPondShoreActorRoot).b'));
  assert.ok(shader.fragmentShader.includes('if (ealdholtShoreBreak > .25) discard;'));
  assert.ok(!shader.fragmentShader.includes('ealdholtShoreStem'));
  assert.ok(shader.fragmentShader.includes('step(ealdholtShoreRootHeight, .12)'));
  handle.dispose();assert.equal(f.borrowed(),0);f.cleanup();
});

test('terrain contact moves the damp/shallow field inside the immutable cap while drawn source buffers stay exact',()=>{
  const f=fixture(),positions=f.terrain.geometry.getAttribute('position');f.terrain.position.y=0;
  for(let i=0;i<4;i++)positions.setY(i,.2*positions.getX(i));
  const before=Array.from(positions.array),handle=applyEaldholtPondShore(f.root),shader=compile(f.pond.material as MeshStandardMaterial);
  const texture=(shader.uniforms as Record<string,{value:unknown}>).uEaldholtPondShoreField.value as DataTexture;
  const bytes=texture.image.data as Uint8Array,bounds=handle.field.bounds;
  function channel(x:number,z:number,c:number){const px=Math.floor((x-bounds.min[0])/(bounds.max[0]-bounds.min[0])*128),pz=Math.floor((z-bounds.min[1])/(bounds.max[1]-bounds.min[1])*128);return bytes[(pz*128+px)*4+c]/255;}
  assert.equal(handle.outline.metrics.area,4);assert.equal(handle.field.contact.mode,'terrain-contact');
  assert.ok(channel(.15,0,0)>0,'bank damp follows terrain/H intersection, not the geometric cap edge');
  assert.ok(channel(-.15,0,1)>0,'shallow tint sits on visible water beside that contact');
  assert.equal(channel(.15,0,1),0,'dry terrain inside the cap receives no shallow-water field');
  assert.deepEqual(Array.from(positions.array),before);assert.equal(f.terrain.geometry.boundingBox,null);
  handle.dispose();assert.equal(f.borrowed(),0);f.cleanup();
});

test('missing/baked or displaced clump-root contracts remain borrowed with explicit diagnostics',()=>{
  for(const fault of ['missing','baked','offset'] as const){
    const f=fixture();let target: Mesh = f.cover;
    if(fault==='missing')delete f.cover.userData.crownfallElderbloom;
    if(fault==='baked'){
      target=new Mesh(f.cover.geometry,f.coverMaterial);target.name='Grass_Clumps_baked';
      target.userData.crownfallElderbloom={kind:'groundcover',referenceDetail:true,sourceInstances:2};
      f.root.remove(f.cover);f.root.add(target);
    }
    if(fault==='offset')f.cover.geometry.translate(0,2,0);
    const handle=applyEaldholtPondShore(f.root);assert.equal(handle.groundcoverMaterials,0,fault);assert.equal(target.material,f.coverMaterial);
    assert.ok(handle.diagnostics.some(row=>row.reason.includes('root')||row.reason.includes('origin')),fault);handle.dispose();assert.equal(f.borrowed(),0);f.cleanup();
  }
});

test('callbacks/cache and source metre projection survive the existing ripple layer and a changed Native root pose',()=>{
  const f=fixture();let renders=0;f.pondMaterial.onBeforeRender=()=>{renders++;};f.pondMaterial.customProgramCacheKey=()=> 'original-key';
  const water=applyEaldholtWaterLook(f.root), ripple=f.pond.material as MeshPhysicalMaterial, handle=applyEaldholtPondShore(f.root), shore=f.pond.material as MeshPhysicalMaterial;
  const shader=compile(shore), uniforms=shader.uniforms as Record<string,{value:unknown}>;
  assert.ok(shader.fragmentShader.includes('CROWNFALL_POND_RIPPLES'));assert.ok(shader.fragmentShader.includes('CROWNFALL_POND_SHORE'));
  assert.equal((shader.fragmentShader.match(/CROWNFALL_POND_RIPPLES/g)??[]).length,1);assert.ok(shore.customProgramCacheKey().includes('original-key'));
  f.root.scale.setScalar(.025);f.root.rotation.set(.7,-.4,.2);f.root.position.set(2,-3,8);f.root.updateWorldMatrix(true,true);
  (shore.onBeforeRender as ()=>void)();assert.equal(renders,1);
  const source=new Vector3(.4,0,-.3), world=source.clone().applyMatrix4(f.root.matrixWorld), recovered=world.applyMatrix4(uniforms.uEaldholtPondShoreWorldToSource.value as Matrix4);
  assert.ok(recovered.distanceTo(source)<1e-10);assert.equal(handle.frameValid,true);
  const actor=new Matrix4();f.cover.getMatrixAt(0,actor);
  const rootPosition=new Vector3().setFromMatrixPosition(new Matrix4().multiplyMatrices(f.cover.matrixWorld,actor))
    .applyMatrix4(uniforms.uEaldholtPondShoreWorldToSource.value as Matrix4);
  assert.ok(rootPosition.distanceTo(new Vector3().setFromMatrixPosition(actor))<1e-10,'retained Float32 instance origin survives complete Native pose');
  handle.dispose();assert.equal(f.pond.material,ripple);water.dispose();assert.equal(f.pond.material,f.pondMaterial);assert.equal(f.borrowed(),0);f.cleanup();
});

test('foreign material slots/replacements survive disposal and each owned material is released once',()=>{
  const f=fixture(), untouched=new MeshStandardMaterial(), foreign=new MeshStandardMaterial(), original=[f.pondMaterial,untouched];
  f.pond.material=original;f.geometry.clearGroups();f.geometry.addGroup(0,6,0);
  const handle=applyEaldholtPondShore(f.root), assigned=f.pond.material as MeshStandardMaterial[];
  let disposed=0;assigned[0].addEventListener('dispose',()=>disposed++);assigned[1]=foreign;f.terrain.material=foreign;
  handle.dispose();handle.dispose();assert.deepEqual(f.pond.material,[f.pondMaterial,foreign]);assert.equal(f.terrain.material,foreign);assert.equal(disposed,1);
  assert.deepEqual(original,[f.pondMaterial,untouched]);assert.equal(f.borrowed(),0);untouched.dispose();foreign.dispose();f.cleanup();
});

test('failed cap qualification and cancelled setup leave the exact source assignments intact',()=>{
  for(const fault of ['truncated','warped','absent','terrain-absent','terrain-truncated','abort'] as const){
    const f=fixture(), controller=new AbortController();
    if(fault==='truncated')f.geometry.setDrawRange(0,5);
    if(fault==='warped')f.geometry.getAttribute('position').setY(0,.02);
    if(fault==='absent')f.pondMaterial.name='Unverified water';
    if(fault==='terrain-absent')f.root.remove(f.terrain);
    if(fault==='terrain-truncated')f.terrain.geometry.setDrawRange(0,5);
    if(fault==='abort')controller.abort();
    assert.throws(()=>applyEaldholtPondShore(f.root,{signal:controller.signal}),fault);
    assert.equal(f.pond.material,f.pondMaterial);assert.equal(f.terrain.material,f.terrainMaterial);assert.equal(f.cover.material,f.coverMaterial);assert.equal(f.borrowed(),0);f.cleanup();
  }
});

test('unsupported nearby groundcover is diagnosed and distant source flowers retain their assignments',()=>{
  const f=fixture();f.coverMaterial.transparent=true;
  const far=new InstancedMesh(f.cover.geometry,f.coverMaterial,1);far.name='flower_01';far.setMatrixAt(0,new Matrix4().makeTranslation(200,0,200));f.root.add(far);
  const handle=applyEaldholtPondShore(f.root);assert.equal(handle.groundcoverMaterials,0);assert.equal(f.cover.material,f.coverMaterial);assert.equal(far.material,f.coverMaterial);
  assert.ok(handle.diagnostics.some(row=>row.reason.includes('ordinary')));handle.dispose();assert.equal(f.borrowed(),0);far.dispose();f.cleanup();
});

test('a clone fault rolls back earlier assignments, while simultaneous owners cannot overwrite the live layer',()=>{
  const f=fixture(), clone=f.terrainMaterial.clone;f.terrainMaterial.clone=()=>{throw Error('clone fault');};
  assert.throws(()=>applyEaldholtPondShore(f.root),/clone fault/);assert.equal(f.pond.material,f.pondMaterial);assert.equal(f.borrowed(),0);
  f.terrainMaterial.clone=clone;
  const first=applyEaldholtPondShore(f.root), assigned=f.pond.material;
  assert.throws(()=>applyEaldholtPondShore(f.root),/ownership is already active/);assert.equal(f.pond.material,assigned);first.dispose();assert.equal(f.borrowed(),0);f.cleanup();
});
