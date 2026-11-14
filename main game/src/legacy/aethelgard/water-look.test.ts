import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, Texture, Vector3 } from 'three';
import { applyEaldholtWaterLook } from './water-look';

test('water look owns replacements, preserves shared source textures and restores exact assignments',()=>{
  const root=new Group(),normal=new Texture(),environment=new Texture();normal.channel=2;normal.repeat.set(4,5);normal.offset.set(.2,.3);
  const water=new MeshStandardMaterial({normalMap:normal,color:0x7e8799,roughness:.3,metalness:0});
  water.name='Crownfall_Pond_Water_Review';
  const stone=new MeshStandardMaterial({color:0x555555});stone.name='OtherWaterOrStone';
  const originalColour=water.color.clone(),geometry=new BoxGeometry();
  const pond=new Mesh(geometry,water),mixed=new Mesh(geometry,[stone,water]),unknown=new Mesh(geometry,stone);
  root.add(pond,mixed,unknown);const originalArray=mixed.material;
  let sourceDisposals=0,textureDisposals=0;water.addEventListener('dispose',()=>sourceDisposals++);normal.addEventListener('dispose',()=>textureDisposals++);
  environment.addEventListener('dispose',()=>textureDisposals++);
  const result=applyEaldholtWaterLook(root,environment);assert.equal(result.materialCount,1);
  assert.ok(pond.material instanceof MeshPhysicalMaterial);const replacement=pond.material;
  assert.notEqual(replacement,water);assert.equal(mixed.material[1],replacement);assert.equal(mixed.material[0],stone);assert.equal(unknown.material,stone);
  assert.equal(replacement.normalMap,normal);assert.equal(normal.channel,2);assert.deepEqual(normal.repeat.toArray(),[4,5]);assert.deepEqual(normal.offset.toArray(),[.2,.3]);
  assert.equal(replacement.envMap,environment);assert.equal(water.envMap,null);
  assert.ok(water.color.equals(originalColour));assert.equal(water.roughness,.3);assert.equal(water.name,'Crownfall_Pond_Water_Review');
  assert.equal(replacement.metalness,0);assert.equal(replacement.ior,1.333);assert.equal(replacement.transmission,0);assert.equal(replacement.clearcoat,0);
  assert.equal(replacement.transparent,false);assert.equal(replacement.opacity,1);assert.equal(replacement.depthWrite,true);assert.equal(replacement.depthTest,true);
  assert.equal(replacement.defines?.PHYSICAL,'');assert.equal(replacement.normalScale.x,water.normalScale.x);
  let replacementDisposals=0;replacement.addEventListener('dispose',()=>replacementDisposals++);
  result.dispose();result.dispose();assert.equal(replacementDisposals,1);assert.equal(sourceDisposals,0);assert.equal(textureDisposals,0);
  assert.equal(pond.material,water);assert.equal(mixed.material,originalArray);assert.equal(unknown.material,stone);
  geometry.dispose();water.dispose();stone.dispose();normal.dispose();environment.dispose();
});


test('owned ripple time freezes under pause and keeps miniature waves at source-metre scale', () => {
  const source = new MeshStandardMaterial(); source.name = 'Crownfall_Pond_Water_Review';
  const geometry = new BoxGeometry(), pond = new Mesh(geometry, source), root = new Group(); root.add(pond);
  const result = applyEaldholtWaterLook(root, null, { metresPerWorldUnit: 50 });
  const material = pond.material as MeshPhysicalMaterial;
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <normal_fragment_maps>' };
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as Parameters<typeof material.onBeforeCompile>[1]);
  assert.equal(shader.uniforms.uEaldholtMetresPerWorldUnit.value, 50);
  const wind = { wind: [0, 1] as const, windStrength: .8 };
  result.update(8, true, wind); assert.equal(shader.uniforms.uEaldholtRippleTime.value, 0, 'late loading anchors the phase');
  result.update(8.05, true, wind); const beforePause = shader.uniforms.uEaldholtRippleTime.value as number;
  assert.ok(Math.abs(beforePause - .05) < 1e-10);
  assert.deepEqual(shader.uniforms.uEaldholtWaterWindDirection.value, { x: Math.cos(Math.PI / 2), y: 1 });
  assert.ok((shader.uniforms.uEaldholtWaterWindStrength.value as number) > 0);
  result.update(30, false, { wind: [1, 0], windStrength: 0 }); assert.equal(shader.uniforms.uEaldholtRippleTime.value, beforePause);
  const pausedStrength = shader.uniforms.uEaldholtWaterWindStrength.value;
  result.update(3000, true, wind); assert.equal(shader.uniforms.uEaldholtRippleTime.value, beforePause, 'resume does not jump to absolute time');
  assert.equal(shader.uniforms.uEaldholtWaterWindStrength.value, pausedStrength);
  result.update(Number.NaN, true, wind); assert.equal(shader.uniforms.uEaldholtRippleTime.value, beforePause);
  result.dispose(); result.update(5000, true, wind); assert.equal(shader.uniforms.uEaldholtRippleTime.value, beforePause);
  assert.equal(pond.material, source); assert.throws(() => applyEaldholtWaterLook(root, null, { metresPerWorldUnit: 0 }));
  geometry.dispose(); source.dispose();
});


test('source-root ripple sampling survives miniature zoom, rotation and translated recentering', () => {
  const pivot = new Group(), root = new Group(); pivot.add(root);
  root.scale.setScalar(.02); root.position.set(-.5, -.02, -.5); pivot.position.set(1, -.85, -3.8);
  const source = new MeshStandardMaterial(); source.name = 'Crownfall_Pond_Water_Review';
  const geometry = new BoxGeometry(), pond = new Mesh(geometry, source); root.add(pond);
  const result = applyEaldholtWaterLook(root, null, { metresPerWorldUnit: 50 });
  const material = pond.material as MeshPhysicalMaterial;
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <normal_fragment_maps>' };
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as Parameters<typeof material.onBeforeCompile>[1]);
  const wind = { wind: [-.6, .8] as const, windStrength: .7 };
  result.update(0, true, wind); result.update(.1, true, wind);
  const bearing = { ...(shader.uniforms.uEaldholtWaterWindDirection.value as { x: number; y: number }) };
  assert.ok(Math.abs(bearing.x + .6) < 1e-12 && Math.abs(bearing.y - .8) < 1e-12);
  const point = new Vector3(-10.4, 1.05, -4.4), slope = new Vector3(-.03, 0, -.02);
  for (const zoom of [.7, 1, 1.3]) for (const tilt of [-.18, 0, .18]) {
    pivot.scale.setScalar(zoom); pivot.rotation.set(tilt, .7, 0); root.position.x = -.6;
    material.onBeforeRender(...([] as unknown as Parameters<typeof material.onBeforeRender>));
    assert.deepEqual(shader.uniforms.uEaldholtWaterWindDirection.value, bearing, 'display rotation must not rotate wind twice in source space');
    const world = point.clone().applyMatrix4(root.matrixWorld);
    const recovered = world.applyMatrix4(shader.uniforms.uEaldholtWaterWorldToSource.value as Matrix4);
    assert.ok(recovered.distanceTo(point) < 1e-10, 'zoom/recentering must not make ripples slide over the source');
    const transformedSlope = slope.clone().applyMatrix4(shader.uniforms.uEaldholtWaterSourceRotation.value as Matrix4);
    const expectedSlope = slope.clone().applyQuaternion(root.getWorldQuaternion(new Quaternion()));
    assert.ok(transformedSlope.distanceTo(expectedSlope) < 1e-10, 'slope must follow the miniature orientation without zoom amplification');
  }
  result.dispose(); geometry.dispose(); source.dispose();
});

test('pond gravity program and resource identity stay stable across wind and reduced-motion updates', () => {
  const source = new MeshStandardMaterial(); source.name = 'Crownfall_Pond_Water_Review';
  const root = new Group(), geometry = new BoxGeometry(), pond = new Mesh(geometry, source); root.add(pond);
  const result = applyEaldholtWaterLook(root), material = pond.material as MeshPhysicalMaterial;
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <normal_fragment_maps>' };
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as Parameters<typeof material.onBeforeCompile>[1]);
  const program = material.customProgramCacheKey(), version = material.version, vertex = shader.vertexShader, fragment = shader.fragmentShader;
  const direction = shader.uniforms.uEaldholtWaterWindDirection, strength = shader.uniforms.uEaldholtWaterWindStrength;
  assert.match(program, /v5-gravity$/); assert.match(fragment, /CROWNFALL_POND_GRAVITY_RIPPLES/);
  assert.equal((fragment.match(/ripples \+= ealdholtPondGravityBand\(/g) ?? []).length, 5);
  result.update(0, true, { wind: [1, 0], windStrength: .4 });
  result.update(.1, true, { wind: [-1, 0], windStrength: .9 });
  const phase = shader.uniforms.uEaldholtRippleTime.value, calm = strength.value;
  result.update(1, false, { wind: [0, 1], windStrength: 0 });
  assert.equal(shader.uniforms.uEaldholtRippleTime.value, phase); assert.equal(strength.value, calm);
  assert.equal(material.customProgramCacheKey(), program); assert.equal(material.version, version);
  assert.equal(shader.vertexShader, vertex); assert.equal(shader.fragmentShader, fragment);
  assert.equal(shader.uniforms.uEaldholtWaterWindDirection, direction); assert.equal(shader.uniforms.uEaldholtWaterWindStrength, strength);
  assert.equal(pond.geometry, geometry);
  result.dispose(); geometry.dispose(); source.dispose();
});


test('one borrowed water backend receives distinct pond/trough profiles without owning imported resources',()=>{
 const root=new Group(),geometry=new BoxGeometry(),pondSource=new MeshStandardMaterial(),troughSource=new MeshStandardMaterial();
 pondSource.name='Crownfall_Pond_Water_Review';troughSource.name='Crownfall_Trough_Water_Review';const pond=new Mesh(geometry,pondSource),trough=new Mesh(geometry,troughSource);root.add(pond,trough);
 const calls:{profile:string;frame:unknown}[]=[];let backendDisposals=0;
 const backend={diagnostics:{backend:'test-borrowed'},patchShader(_shader:unknown,frame:unknown,profile:string){calls.push({profile,frame});},dispose(){backendDisposals++;}} as unknown as NonNullable<NonNullable<Parameters<typeof applyEaldholtWaterLook>[2]>['openWater']>;
 const look=applyEaldholtWaterLook(root,null,{openWater:backend});
 for(const mesh of[pond,trough]){const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <normal_fragment_maps>'};(mesh.material as MeshPhysicalMaterial).onBeforeCompile(shader as never,null as never);}
 assert.deepEqual(calls.map(c=>c.profile),['pond','trough']);assert.equal(calls[0].frame,calls[1].frame,'one source transform per owner');
 assert.notEqual((pond.material as MeshPhysicalMaterial).customProgramCacheKey(),(trough.material as MeshPhysicalMaterial).customProgramCacheKey());
 look.dispose();assert.equal(backendDisposals,0,'the per-view backend outlives individual surface adapters');assert.equal(pond.material,pondSource);assert.equal(trough.material,troughSource);
 geometry.dispose();pondSource.dispose();troughSource.dispose();
});
