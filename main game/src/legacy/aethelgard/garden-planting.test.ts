import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferGeometry, DirectionalLight, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, ShaderLib, SkinnedMesh,
  type WebGLRenderer } from 'three';
import { createEaldholtGardenPlanting } from './garden-planting';
import { createWorldEnvironment } from './world-environment';
import { createWorldPreparationQueue } from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
function plane(size:number,y:number){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(
  [-size,y,-size,-size,y,size,size,y,size,-size,y,-size,size,y,size,size,y,-size],3));return g;}
function fixture(){const root=new Group(),water=new MeshStandardMaterial();water.name='Crownfall_Pond_Water_Review';
  const pond=new Mesh(plane(10,0),water),land=new Mesh(plane(25,.2),new MeshStandardMaterial());land.name='LandscapeComponent_0';
  const prop=new Mesh(plane(2,.3),new MeshStandardMaterial());prop.name='Authored path and bench';prop.position.set(13,0,0);
  root.add(pond,land,prop);return{root,pond,land,prop};}
function compile(material:MeshStandardMaterial){const source=ShaderLib.standard,shader={uniforms:{},vertexShader:source.vertexShader,fragmentShader:source.fragmentShader};
  material.onBeforeCompile(shader as Parameters<MeshStandardMaterial['onBeforeCompile']>[0],{} as WebGLRenderer);return shader;}

test('only owned instanced flora is created; borrowed source geometry, draws, transforms and materials remain exact',()=>{
  const f=fixture(),raw=Array.from(f.land.geometry.getAttribute('position').array),borrowed=[f.pond.geometry,f.land.geometry,f.prop.geometry,f.pond.material,f.land.material,f.prop.material];
  let sourceDisposals=0;for(const resource of borrowed)resource.addEventListener('dispose',()=>sourceDisposals++);
  const handle=createEaldholtGardenPlanting(f.root);assert.equal(handle.stats.qualified,true);assert.ok(handle.stats.plants>15);assert.equal(handle.object.parent,null);
  assert.equal(f.root.children.length,3);assert.equal(handle.stats.drawCalls,handle.object.children.length);assert.ok(handle.stats.drawCalls<=15);
  for(const child of handle.object.children){assert.ok(child instanceof InstancedMesh);assert.ok(child.material instanceof MeshStandardMaterial);
    assert.equal(child.castShadow,false);assert.ok(child.count>0);assert.equal(child.material.vertexColors,true);}
  assert.deepEqual(Array.from(f.land.geometry.getAttribute('position').array),raw);assert.equal(f.land.geometry.boundingBox,null);
  assert.equal(handle.stats.blockedFootprints,1);assert.deepEqual(handle.anchor,[0,0,0]);
  let ownDisposals=0;for(const child of handle.object.children){const mesh=child as InstancedMesh;mesh.geometry.addEventListener('dispose',()=>ownDisposals++);
    (mesh.material as MeshStandardMaterial).addEventListener('dispose',()=>ownDisposals++);}
  const expected=handle.object.children.length*2;f.root.add(handle.object);handle.dispose();handle.dispose();
  assert.equal(sourceDisposals,0);assert.equal(ownDisposals,expected);assert.equal(f.root.children.length,3);assert.equal(handle.object.children.length,0);
});

test('source metre placements survive Native presentation transforms and reduced motion holds existing-clock phase',()=>{
  const a=fixture(),b=fixture(),one=createEaldholtGardenPlanting(a.root);
  b.root.position.set(3,-1,8);b.root.rotation.set(.4,.7,-.2);b.root.scale.setScalar(.035);
  const two=createEaldholtGardenPlanting(b.root,{profile:'desktop'});assert.equal(two.stats.qualified,true);
  assert.equal(two.stats.plants,one.stats.plants);assert.deepEqual(two.stats.species,one.stats.species);
  for(let k=0;k<one.object.children.length;k++){const A=one.object.children[k] as InstancedMesh,B=two.object.children[k] as InstancedMesh;
    assert.deepEqual(Array.from(A.instanceMatrix.array),Array.from(B.instanceMatrix.array));}
  b.root.add(two.object);const batch=two.object.children.find(o=>!o.name.includes('lily')) as InstancedMesh,shader=compile(batch.material as MeshStandardMaterial),
    uniforms=shader.uniforms as Record<string,{value:unknown}>;
  two.update(12,true,{direction:[1,0],strength:.6});assert.equal(uniforms.cfEnvironmentSeconds.value,12);assert.equal(uniforms.cfWindStrength.value,.6);
  two.update(200,false,{direction:[0,1],strength:1});assert.equal(uniforms.cfEnvironmentSeconds.value,12);assert.equal(uniforms.cfWindStrength.value,.6);
  b.root.position.x+=2;two.update(200,false);b.root.updateWorldMatrix(true,false);
  assert.ok((uniforms.cfEnvironmentToSource.value as Matrix4).equals(new Matrix4().copy(b.root.matrixWorld).invert()));
  two.update(12,true,{direction:[0,1],strength:1});assert.equal(uniforms.cfWindStrength.value,.6,'same paused clock does not advance wind');
  two.update(13,true,[0,0]);assert.equal(uniforms.cfWindStrength.value,0);
  assert.ok(shader.vertexShader.includes('CROWNFALL_VEGETATION_WIND'));assert.ok(shader.fragmentShader.includes('#include <lights_fragment_begin>'));
  one.dispose();two.dispose();
});

test('mirrored static props, pond cap and Landscape preserve source buffers and the exact qualified planting',()=>{
  const f=fixture();for(const mesh of [f.pond,f.land,f.prop])mesh.geometry.setIndex([0,1,2,3,4,5]);
  const baseline=createEaldholtGardenPlanting(f.root),before=[f.pond,f.land,f.prop].map(mesh=>({geometry:mesh.geometry,material:mesh.material,
    position:Array.from(mesh.geometry.getAttribute('position').array),index:mesh.geometry.index?Array.from(mesh.geometry.index.array):null}));
  f.pond.scale.x=-1;f.land.scale.z=-1;f.prop.scale.x=-1;const mirror=createEaldholtGardenPlanting(f.root);
  assert.equal(mirror.stats.qualified,true,mirror.stats.holdReason??'');assert.equal(mirror.stats.plants,baseline.stats.plants);
  assert.deepEqual(mirror.stats.species,baseline.stats.species);assert.deepEqual(mirror.anchor,baseline.anchor);
  for(let i=0;i<baseline.object.children.length;i++)assert.deepEqual(Array.from((mirror.object.children[i] as InstancedMesh).instanceMatrix.array),Array.from((baseline.object.children[i] as InstancedMesh).instanceMatrix.array));
  for(const [i,mesh] of [f.pond,f.land,f.prop].entries()){assert.equal(mesh.geometry,before[i].geometry);assert.equal(mesh.material,before[i].material);
    assert.deepEqual(Array.from(mesh.geometry.getAttribute('position').array),before[i].position);assert.deepEqual(Array.from(mesh.geometry.index!.array),before[i].index);assert.equal(mesh.geometry.boundingBox,null);}
  assert.equal(f.pond.scale.x,-1);assert.equal(f.land.scale.z,-1);assert.equal(f.prop.scale.x,-1);baseline.dispose();mirror.dispose();
});

test('mirrored static instance matrices qualify, while zero/nonfinite actors and mirrored roots remain held',()=>{
  const f=fixture(),original=f.pond,pond=new InstancedMesh(original.geometry,original.material,1),matrix=new Matrix4().makeScale(-1,1,1);
  pond.setMatrixAt(0,matrix);f.root.remove(original);f.root.add(pond);const before=Array.from(pond.instanceMatrix.array),accepted=createEaldholtGardenPlanting(f.root);
  assert.equal(accepted.stats.qualified,true,accepted.stats.holdReason??'');assert.deepEqual(Array.from(pond.instanceMatrix.array),before);accepted.dispose();
  for(const scale of [0,NaN]){f.prop.scale.x=scale;const held=createEaldholtGardenPlanting(f.root);assert.equal(held.stats.qualified,false);assert.match(held.stats.holdReason??'',/actor transform.*Authored path and bench/);held.dispose();}
  f.prop.scale.x=1;f.root.scale.x=-1;const rootHeld=createEaldholtGardenPlanting(f.root);assert.equal(rootHeld.stats.qualified,false);assert.match(rootHeld.stats.holdReason??'',/source transform/);rootHeld.dispose();pond.dispose();
});

test('missing or ambiguous pond and unsupported Landscape fail closed with explicit stats',()=>{
  const f=fixture();f.root.remove(f.land);const missing=createEaldholtGardenPlanting(f.root);
  assert.equal(missing.stats.qualified,false);assert.match(missing.stats.holdReason??'',/Landscape/);assert.equal(missing.object.children.length,0);assert.equal(missing.anchor,null);
  missing.dispose();const noPond=createEaldholtGardenPlanting(new Group());assert.equal(noPond.stats.qualified,false);assert.match(noPond.stats.holdReason??'',/pond shore/);noPond.dispose();
});

test('only explicitly owned generated resident roots are excluded; unknown animated source obstacles still hold planting',()=>{
  const f=fixture(),dynamic=new Group(),actor=new SkinnedMesh(plane(.3,0),new MeshStandardMaterial());dynamic.add(actor);f.root.add(dynamic);
  const held=createEaldholtGardenPlanting(f.root);assert.equal(held.stats.qualified,false);assert.match(held.stats.holdReason??'',/static authored footprint/);held.dispose();
  dynamic.userData.crownfallGardenDynamic=true;const accepted=createEaldholtGardenPlanting(f.root);
  assert.equal(accepted.stats.qualified,true);assert.ok(accepted.stats.plants>15);assert.equal(accepted.stats.blockedFootprints,1);assert.equal(dynamic.children[0],actor);
  accepted.dispose();actor.geometry.dispose();(actor.material as MeshStandardMaterial).dispose();
});

test('generated owner exclusion precedes descendant terrain roles and never reads far geometry into local Landscape support',()=>{
  const f=fixture(),baseline=createEaldholtGardenPlanting(f.root),owned:BufferGeometry[]=[];
  for(const key of ['crownfallRiverValley','crownfallFarSurround','crownfallFarSurroundBridge','crownfallRegionalHorizon','crownfallRegionalGroundcover',
    'crownfallRiverWoodland','crownfallFarWoodland','crownfallAtmosphere','crownfallRegionalRocks','crownfallRegionalLandmarks']){
    const owner=new Group();owner.userData[key]={schema:1,localPlacementEligible:false};
    const geometry=plane(1000,.2),mesh=new Mesh(geometry,new MeshStandardMaterial());mesh.name='LandscapeComponent_999';mesh.userData.crownfallElderbloom={kind:'terrain'};
    Object.defineProperty(geometry.attributes,'position',{configurable:true,get(){throw Error('Generated far geometry must not be examined.');}});
    owner.add(mesh);f.root.add(owner);owned.push(geometry);
  }
  const garden=createEaldholtGardenPlanting(f.root);assert.equal(garden.stats.qualified,true);assert.equal(garden.stats.terrainTriangles,2);
  assert.deepEqual(garden.stats.species,baseline.stats.species);assert.equal(garden.stats.blockedFootprints,baseline.stats.blockedFootprints);
  baseline.dispose();garden.dispose();for(const geometry of owned)geometry.dispose();
});

for(const mode of [{native:false,quality:'medium'},{native:false,quality:'high'},{native:true,quality:'low'}] as const){
  test(`real ${mode.native?'Native':'Desktop'} ${mode.quality} environment publishes garden PBR clones with one wind/weather uniform owner`,async()=>{
    const prior=Object.getOwnPropertyDescriptor(globalThis,'Worker');Object.defineProperty(globalThis,'Worker',{value:undefined,configurable:true,writable:true});
    const f=fixture(),garden=createEaldholtGardenPlanting(f.root,{profile:mode.native?'quest':'desktop'}),scene=new Scene(),atmosphere=new Group(),sun=new DirectionalLight(),camera=new PerspectiveCamera();
    f.root.add(garden.object);scene.add(f.root,atmosphere,sun);
    const nodes=garden.object.children as InstancedMesh[],bases=nodes.map(n=>n.material),queue=createWorldPreparationQueue(()=>{},64);
    let compiles=0;
    const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},async compileAsync(){compiles++;},render(){throw Error('CPU composition test must not draw.');}} as unknown as WebGLRenderer;
    const environment=createWorldEnvironment({sourceRoot:f.root,atmosphere,scene,sun,camera,renderer,queue,signal:new AbortController().signal,native:mode.native,
      quality:()=>mode.quality,reducedMotion:()=>false,readClock:()=>null,setSunDirection(){},changed(){}});
    try{
      for(let turn=0;turn<100&&(turn===0||environment.stats.materialGraphPending||queue.pending);turn++){
        environment.prepare(turn*32,true);if(queue.pending)queue.step();await new Promise<void>(resolve=>setImmediate(resolve));await new Promise<void>(resolve=>setImmediate(resolve));}
      environment.prepare(10_000,true);assert.ok(compiles>0);assert.ok(environment.stats.windProgramsReady>0);
      assert.ok(nodes.some((n,i)=>n.material!==bases[i]),'real environment publishes its own prepared material bindings');
      for(const node of nodes){const shader=compile(node.material as MeshStandardMaterial);
        assert.equal(shader.vertexShader.split('#define CROWNFALL_VEGETATION_WIND').length,2);
        for(const name of ['cfEnvironmentToSource','cfEnvironmentSeconds','cfWindStrength','cfWindDirection']){
          const definitions=shader.vertexShader.match(new RegExp('uniform\\s+\\w+\\s+'+name+'\\s*;','g'))??[];
          assert.equal(definitions.length,1,name+' has one actual assembled vertex declaration');}
        assert.ok(shader.fragmentShader.includes('#include <lights_physical_fragment>'));
        assert.ok(shader.fragmentShader.includes('#include <roughnessmap_fragment>'));
        if(!mode.native)assert.ok(shader.fragmentShader.includes('CROWNFALL_WORLD_ENVIRONMENT'));
      }
      environment.dispose();queue.dispose();await queue.whenIdle();assert.ok(nodes.every((n,i)=>n.material===bases[i]));
    }finally{environment.dispose();queue.dispose();await queue.whenIdle();garden.dispose();
      for(const mesh of [f.pond,f.land,f.prop]){mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();}
      if(prior)Object.defineProperty(globalThis,'Worker',prior);else Reflect.deleteProperty(globalThis,'Worker');}
  });
}
