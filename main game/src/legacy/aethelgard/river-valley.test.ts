import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, ShaderLib, Texture, Vector3 } from 'three';
import { createEaldholtRiverValley, EALDHOLT_BANK_ART_VERSION } from './river-valley';
import { collectEaldholtTerrainEdges } from '../../../../shared/legacy/aethelgard/environment/river-valley';
import { createEaldholtCoastalValleyBuffers } from '../../../../shared/legacy/aethelgard/environment/coastal-valley';
import { createEaldholtBankExposureSections, EALDHOLT_WOODLAND_BANK_ART_VERSION } from '../../../../shared/legacy/aethelgard/environment/woodland-ground';
import {packEaldholtBankExposure,ealdholtBankLookupUniformVectors,EALDHOLT_BANK_KNOT_PROGRAM_KEY} from '../../../../shared/legacy/aethelgard/environment/authored-bank-knots';
import {bankStageDiagnosticSignature} from '../../../../shared/legacy/aethelgard/environment/bank-material-diagnostics';
import { EALDHOLT_RIVER_FLOW_PROGRAM_KEY } from '../../../../shared/legacy/aethelgard/environment/river-flow-shader';
import { EALDHOLT_WATER_SHORE_CACHE_KEY } from '../../../../shared/legacy/aethelgard/environment/water-shore-color';

test('river adapter ignores display-root scale, includes actual bounds and disposes only owned state',()=>{
  const root=new Group();root.scale.setScalar(.02);root.position.set(2,3,-4);root.rotation.y=.4;
  const sourceGeometry=new PlaneGeometry(20,20,4,4);sourceGeometry.rotateX(-Math.PI/2);const sourceMaterial=new MeshStandardMaterial();
  const source=new Mesh(sourceGeometry,sourceMaterial);source.name='LandscapeComponent_0';source.position.set(4,2,-2);source.scale.set(1.1,1,1.2);root.add(source);
  const originalPositions=Array.from(sourceGeometry.getAttribute('position').array),albedo=new Texture(),normal=new Texture(),orm=new Texture(),environment=new Texture();normal.channel=orm.channel=2;
  let borrowedDisposals=0;for(const resource of [sourceGeometry,sourceMaterial,albedo,normal,orm,environment])resource.addEventListener('dispose',()=>borrowedDisposals++);
  const handle=createEaldholtRiverValley(root,{albedo,normal,orm},{profile:'quest',environment});
  assert.equal(handle.object.parent,null);assert.equal(handle.drawCalls,3);assert.ok(handle.bufferBytes<1024*1024);assert.ok(handle.triangles<15000);
  assert.ok(handle.bounds.min[0]<-37,"Connected sea must extend beyond the former isolated bank");assert.ok(Math.abs(handle.bounds.max[0]-45)<1e-4);
  const beforeBounds=new Box3().setFromObject(root);root.add(handle.object);const afterBounds=new Box3().setFromObject(root);
  assert.ok(afterBounds.getSize(root.position.clone()).length()>beforeBounds.getSize(root.position.clone()).length()*2);
  assert.equal(handle.object.userData.iwsdkPreviewBounds,undefined);assert.deepEqual(Array.from(sourceGeometry.getAttribute('position').array),originalPositions);assert.equal(source.material,sourceMaterial);
  const land=handle.object.children[0]as Mesh,water=handle.object.children[1]as Mesh,sea=handle.object.children[2]as Mesh,waterMaterial=water.material as MeshPhysicalMaterial;
  assert.equal((land.material as MeshStandardMaterial).map,albedo);assert.equal((land.material as MeshStandardMaterial).normalMap,normal);
  assert.equal(sea.material,water.material);assert.equal(water.receiveShadow,false);assert.equal(sea.receiveShadow,false);
  assert.equal(land.userData.crownfallElderbloom.kind,"terrain");assert.equal(land.geometry.getAttribute("ealdholtShoreWetness").count,land.geometry.getAttribute("position").count);
  assert.equal(waterMaterial.envMap,environment);assert.equal(waterMaterial.metalness,0);assert.equal(waterMaterial.ior,1.333);
  const shader={uniforms:{} as Record<string,{value:unknown}>,vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_physical_fragment>'};waterMaterial.onBeforeCompile(shader as never,null as never);
  handle.update(4,true,{wind:[0,1],windStrength:0});assert.equal(shader.uniforms.uEaldholtRippleTime.value,0);
  handle.update(4.05,true,{wind:[0,1],windStrength:0});const flowTime=shader.uniforms.uEaldholtRippleTime.value as number;assert.ok(Math.abs(flowTime-.05)<1e-10);
  assert.equal(shader.uniforms.uEaldholtWaterWindStrength.value,0,'still wind must not stop independent downstream flow time');
  assert.match(shader.fragmentShader,/normalize\(vec2\(-1\., -clamp\(slope/);assert.match(shader.fragmentShader,/coord = vec2\(-p\.x, shore\.x\)/);
  assert.equal(waterMaterial.customProgramCacheKey(),EALDHOLT_RIVER_FLOW_PROGRAM_KEY+EALDHOLT_WATER_SHORE_CACHE_KEY);
  handle.update(9,false,{wind:[1,0],windStrength:1});assert.equal(shader.uniforms.uEaldholtRippleTime.value,flowTime);
  let ownedDisposals=0;for(const resource of [land.geometry,water.geometry,sea.geometry,land.material,water.material])if(!Array.isArray(resource))resource.addEventListener('dispose',()=>ownedDisposals++);
  handle.dispose();handle.dispose();handle.update(20,true);assert.equal(shader.uniforms.uEaldholtRippleTime.value,flowTime);assert.equal(handle.object.parent,null);assert.equal(ownedDisposals,5);assert.equal(borrowedDisposals,0);
  sourceGeometry.dispose();sourceMaterial.dispose();for(const texture of [albedo,normal,orm,environment])texture.dispose();
});


test('default valley material borrows complete earth/rock PBR sets and keeps source-space maps, geometry and water intact',()=>{
  const root=new Group();root.rotation.set(.5,.3,-.1);root.scale.setScalar(.025);
  const geometry=new PlaneGeometry(20,20,4,4);geometry.rotateX(-Math.PI/2);const sourceMaterial=new MeshStandardMaterial(),source=new Mesh(geometry,sourceMaterial);source.name='LandscapeComponent_0';root.add(source);
  const earth={albedo:new Texture(),normal:new Texture(),orm:new Texture(),meanLuminance:.053};
  const rock={albedo:new Texture(),normal:new Texture(),orm:new Texture(),meanLuminance:.12};
  const textures=[earth.albedo,earth.normal,earth.orm,rock.albedo,rock.normal,rock.orm],before=textures.map(t=>({source:t.source,version:t.version,channel:t.channel,repeat:t.repeat.toArray(),matrix:t.matrix.toArray()}));
  let disposed=0;for(const texture of textures)texture.addEventListener('dispose',()=>disposed++);
  const positions=Array.from(geometry.getAttribute('position').array),handle=createEaldholtRiverValley(root,earth,{profile:'quest',rockMaps:rock});
  const land=handle.object.children[0]as Mesh,material=land.material as MeshStandardMaterial,water=(handle.object.children[1]as Mesh).material as MeshPhysicalMaterial;
  const shader={uniforms:{} as Record<string,{value:unknown}>,vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader as never,null as never);
  assert.equal(shader.uniforms.uEaldholtValleyRockAlbedo.value,rock.albedo);assert.equal(shader.uniforms.uEaldholtValleyRockNormal.value,rock.normal);assert.equal(shader.uniforms.uEaldholtValleyRockOrm.value,rock.orm);
  assert.equal(shader.uniforms.uEaldholtValleyEarthNormal.value,earth.normal);assert.equal(shader.uniforms.uEaldholtValleyEarthOrm.value,earth.orm);
  assert.equal(material.map,earth.albedo);assert.equal(material.normalMap,earth.normal);assert.equal(material.roughnessMap,earth.orm);
  assert.ok(material.customProgramCacheKey().includes(EALDHOLT_BANK_ART_VERSION));assert.equal(material.userData.crownfallRiverSurface.extraTextureBytes,0);
  assert.match(shader.vertexShader,/vEaldholtValleySourcePosition = position/);assert.match(shader.fragmentShader,/ealdholtWeights/);assert.match(shader.fragmentShader,/ealdholtSurfaceNormal/);
  assert.equal(water.roughness,.24);assert.equal(water.ior,1.333);assert.equal(source.material,sourceMaterial);assert.deepEqual(Array.from(geometry.getAttribute('position').array),positions);
  assert.deepEqual(textures.map(t=>({source:t.source,version:t.version,channel:t.channel,repeat:t.repeat.toArray(),matrix:t.matrix.toArray()})),before);
  handle.dispose();handle.dispose();assert.equal(disposed,0);for(const texture of textures)texture.dispose();geometry.dispose();sourceMaterial.dispose();
});

test('grass option is borrowed only by outside land and preserves source geometry, water and map ownership',()=>{
 const root=new Group(),geometry=new PlaneGeometry(20,20,4,4);geometry.rotateX(-Math.PI/2);const sourceMaterial=new MeshStandardMaterial(),source=new Mesh(geometry,sourceMaterial);source.name='LandscapeComponent_0';root.scale.setScalar(.02);root.rotation.set(.4,.3,.1);root.add(source);
 const earth={albedo:new Texture(),meanLuminance:.053},grass={albedo:new Texture(),normal:new Texture(),orm:new Texture(),meanLuminance:.244};let disposed=0;const maps=[grass.albedo,grass.normal,grass.orm],before=maps.map(t=>({source:t.source,sourceVersion:t.source.version,version:t.version,flipY:t.flipY}));for(const texture of maps)texture.addEventListener('dispose',()=>disposed++);
 const baseline=createEaldholtRiverValley(root,earth,{profile:'quest'}),handle=createEaldholtRiverValley(root,earth,{profile:'quest',grassMaps:grass});assert.equal(handle.triangles,baseline.triangles);assert.deepEqual(handle.bounds,baseline.bounds);
 const material=(handle.object.children[0]as Mesh).material as MeshStandardMaterial,plain=(baseline.object.children[0]as Mesh).material as MeshStandardMaterial,shader={uniforms:{}as Record<string,{value:unknown}>,vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader as never,null as never);assert.equal(shader.uniforms.uEaldholtValleyGrassAlbedo.value,grass.albedo);assert.notEqual(material.customProgramCacheKey(),plain.customProgramCacheKey());assert.equal(material.map,earth.albedo);assert.equal(source.material,sourceMaterial);
 for(let i=0;i<3;i++)assert.deepEqual(Array.from((handle.object.children[i]as Mesh).geometry.getAttribute('position').array),Array.from((baseline.object.children[i]as Mesh).geometry.getAttribute('position').array));assert.equal((handle.object.children[1]as Mesh).material instanceof MeshPhysicalMaterial,true);
 assert.deepEqual(maps.map(t=>({source:t.source,sourceVersion:t.source.version,version:t.version,flipY:t.flipY})),before);handle.dispose();baseline.dispose();assert.equal(disposed,0);earth.albedo.dispose();for(const texture of maps)texture.dispose();geometry.dispose();sourceMaterial.dispose();
});


test('qualified bank/meadow pair changes only generated land shading in source metres and borrows every map',()=>{
 const root=new Group();root.position.set(9,3,-7);root.rotation.set(.2,.4,-.1);root.scale.setScalar(.02);
 const geometry=new PlaneGeometry(20,20,4,4);geometry.rotateX(-Math.PI/2);const sourceMaterial=new MeshStandardMaterial(),source=new Mesh(geometry,sourceMaterial);source.name='LandscapeComponent_0';source.position.set(4,2,-2);source.scale.set(1.1,1,1.2);root.add(source);source.updateMatrix();
 const earth={albedo:new Texture(),normal:new Texture(),orm:new Texture(),meanLuminance:.053,tileMetres:1.3,targetLuminance:.06};
 const grass={albedo:new Texture(),normal:new Texture(),orm:new Texture(),meanLuminance:.248,tileMetres:2,targetLuminance:.07};
 const rock={albedo:new Texture(),normal:new Texture(),orm:new Texture(),meanLuminance:.12},environment=new Texture();
 const textures=[earth.albedo,earth.normal,earth.orm,grass.albedo,grass.normal,grass.orm,rock.albedo,rock.normal,rock.orm,environment];
 const snapshots=textures.map(t=>({source:t.source,version:t.version,channel:t.channel,flipY:t.flipY,repeat:t.repeat.toArray(),matrix:t.matrix.toArray()}));
 const originalPositions=Array.from(geometry.getAttribute('position').array);let borrowedDisposals=0;for(const resource of [...textures,geometry,sourceMaterial])resource.addEventListener('dispose',()=>borrowedDisposals++);
 const baseline=createEaldholtRiverValley(root,{...earth,targetLuminance:undefined},{profile:'quest',rockMaps:rock,grassMaps:grass,environment});
 const handle=createEaldholtRiverValley(root,earth,{profile:'quest',rockMaps:rock,grassMaps:grass,environment});
 assert.equal(baseline.artVersion,EALDHOLT_BANK_ART_VERSION);assert.equal(handle.artVersion,EALDHOLT_WOODLAND_BANK_ART_VERSION);
 assert.equal(handle.object.userData.crownfallRiverValley.artVersion,handle.artVersion);
 assert.equal(handle.triangles,baseline.triangles);assert.equal(handle.bufferBytes,baseline.bufferBytes);assert.equal(handle.drawCalls,baseline.drawCalls);assert.deepEqual(handle.bounds,baseline.bounds);assert.deepEqual(handle.viewpoint,baseline.viewpoint);
 for(let i=0;i<3;i++){
  const a=(handle.object.children[i] as Mesh).geometry,b=(baseline.object.children[i] as Mesh).geometry;
  assert.deepEqual(Object.keys(a.attributes),Object.keys(b.attributes));
  for(const name of Object.keys(a.attributes))assert.deepEqual(Array.from(a.getAttribute(name).array),Array.from(b.getAttribute(name).array),`unchanged ${i}:${name}`);
  assert.deepEqual(Array.from(a.getIndex()!.array),Array.from(b.getIndex()!.array));
 }
 const material=(handle.object.children[0] as Mesh).material as MeshStandardMaterial;
 const shader={uniforms:{} as Record<string,{value:unknown}>,vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader as never,null as never);
 assert.match(shader.fragmentShader,/CROWNFALL_WOODLAND_VALLEY_SURFACE/);assert.doesNotMatch(shader.fragmentShader,/uEaldholtValleyCanopy|uEaldholtValleyForestMean/);assert.equal(material.map,earth.albedo);
 assert.equal(shader.uniforms.uEaldholtValleyGrassAlbedo.value,grass.albedo);assert.equal(shader.uniforms.uEaldholtValleyEarthNormal.value,earth.normal);
 const local=new Vector3(),edges=collectEaldholtTerrainEdges(visit=>{const p=geometry.getAttribute('position');for(let i=0;i<p.count;i++){local.fromBufferAttribute(p,i).applyMatrix4(source.matrix);visit(local.x,local.y,local.z);}});
 const expected=createEaldholtBankExposureSections(createEaldholtCoastalValleyBuffers(edges,'quest').shape.channelSamples,64),actual=shader.uniforms.uEaldholtValleyBank.value as Float32Array;
 assert.deepEqual(actual,packEaldholtBankExposure(expected.data,expected.count));assert.deepEqual(shader.uniforms.uEaldholtValleyBankKnots.value,expected.authoredBanks.data);assert.equal(material.userData.crownfallRiverSurface.channelBankKnots,expected.authoredBanks.count);assert.ok(material.customProgramCacheKey().includes(EALDHOLT_BANK_KNOT_PROGRAM_KEY));
 assert.equal(material.userData.crownfallRiverSurface.channelBankSignature,bankStageDiagnosticSignature(expected.authoredBanks.data));assert.equal(material.userData.crownfallRiverSurface.channelBankLookupVersion,EALDHOLT_BANK_KNOT_PROGRAM_KEY);assert.equal(material.userData.crownfallRiverSurface.channelBankUniformVectors,ealdholtBankLookupUniformVectors(expected.authoredBanks.count,expected.count,expected.waterStages.count));
 assert.equal(material.userData.crownfallRiverSurface.version,handle.artVersion);assert.equal(material.userData.crownfallRiverSurface.bankSections,64);assert.equal(material.userData.crownfallRiverSurface.extraTextureBytes,0);assert.equal(material.userData.crownfallRiverSurface.forestMapsBorrowed,false);
 assert.notEqual(material.customProgramCacheKey(),((baseline.object.children[0] as Mesh).material as MeshStandardMaterial).customProgramCacheKey());
 const water=(handle.object.children[1] as Mesh).material as MeshPhysicalMaterial,oldWater=(baseline.object.children[1] as Mesh).material as MeshPhysicalMaterial;
 const waterShader={uniforms:{} as Record<string,{value:unknown}>,vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader},oldWaterShader={uniforms:{} as Record<string,{value:unknown}>,vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
 water.onBeforeCompile(waterShader as never,null as never);oldWater.onBeforeCompile(oldWaterShader as never,null as never);assert.equal(waterShader.vertexShader,oldWaterShader.vertexShader);assert.equal(waterShader.fragmentShader,oldWaterShader.fragmentShader);assert.equal(water.customProgramCacheKey(),oldWater.customProgramCacheKey());assert.equal(water.envMap,environment);
 handle.update(4,true,{wind:[0,1],windStrength:0});handle.update(4.05,true,{wind:[0,1],windStrength:0});const time=waterShader.uniforms.uEaldholtRippleTime.value as number;assert.ok(Math.abs(time-.05)<1e-10);handle.update(8,false,{wind:[1,0],windStrength:1});assert.equal(waterShader.uniforms.uEaldholtRippleTime.value,time);
 let ownedDisposals=0;for(const resource of [...handle.object.children.map(o=>(o as Mesh).geometry),material,water])resource.addEventListener('dispose',()=>ownedDisposals++);
 assert.deepEqual(textures.map(t=>({source:t.source,version:t.version,channel:t.channel,flipY:t.flipY,repeat:t.repeat.toArray(),matrix:t.matrix.toArray()})),snapshots);
 assert.deepEqual(Array.from(geometry.getAttribute('position').array),originalPositions);assert.equal(source.material,sourceMaterial);
 handle.dispose();handle.dispose();baseline.dispose();handle.update(20,true);assert.equal(waterShader.uniforms.uEaldholtRippleTime.value,time);assert.equal(ownedDisposals,5);assert.equal(borrowedDisposals,0);
 for(const texture of textures)texture.dispose();geometry.dispose();sourceMaterial.dispose();
});

test('incomplete layer targets retain v2 while qualified targets and physical tile sizes identify distinct programs',()=>{
 const root=new Group(),geometry=new PlaneGeometry(20,20,4,4);geometry.rotateX(-Math.PI/2);const sourceMaterial=new MeshStandardMaterial(),source=new Mesh(geometry,sourceMaterial);source.name='LandscapeComponent_0';root.add(source);
 const earth={albedo:new Texture(),meanLuminance:.053,tileMetres:1.3,targetLuminance:.06},grass={albedo:new Texture(),meanLuminance:.248,tileMetres:2,targetLuminance:.07};
 const a=createEaldholtRiverValley(root,earth,{profile:'quest',grassMaps:grass});
 for(const maps of [{...grass,targetLuminance:undefined},{...grass,tileMetres:undefined},{...grass,targetLuminance:NaN}]){
  const handle=createEaldholtRiverValley(root,earth,{profile:'quest',grassMaps:maps}),material=(handle.object.children[0] as Mesh).material as MeshStandardMaterial;
  const shader={uniforms:{} as Record<string,{value:unknown}>,vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader as never,null as never);
  assert.equal(handle.artVersion,EALDHOLT_BANK_ART_VERSION);assert.doesNotMatch(shader.fragmentShader,/CROWNFALL_WOODLAND_VALLEY_SURFACE/);assert.match(shader.fragmentShader,/float neutral=/);handle.dispose();
 }
 const b=createEaldholtRiverValley(root,{...earth,tileMetres:1.5},{profile:'quest',grassMaps:{...grass,targetLuminance:.075}});
 assert.notEqual(((a.object.children[0] as Mesh).material as MeshStandardMaterial).customProgramCacheKey(),((b.object.children[0] as Mesh).material as MeshStandardMaterial).customProgramCacheKey());
 a.dispose();b.dispose();earth.albedo.dispose();grass.albedo.dispose();geometry.dispose();sourceMaterial.dispose();
});


test('spectral sea has no river current while all far continuations borrow the same live materials',()=>{
 const root=new Group(),geometry=new PlaneGeometry(20,20,4,4);geometry.rotateX(-Math.PI/2);const original=new MeshStandardMaterial(),terrain=new Mesh(geometry,original);terrain.name='LandscapeComponent_0';root.add(terrain);
 const profiles:string[]=[];let backendDisposals=0;
 const backend={diagnostics:{backend:'borrowed'},patchShader(_shader:unknown,_frame:unknown,profile:string){profiles.push(profile);},dispose(){backendDisposals++;}} as unknown as NonNullable<NonNullable<Parameters<typeof createEaldholtRiverValley>[2]>['openWater']>;
 const handle=createEaldholtRiverValley(root,undefined,{openWater:backend}),water=handle.object.children[1]as Mesh,sea=handle.object.children[2]as Mesh;
 assert.notEqual(water.material,sea.material);
 const compile=(mesh:Mesh)=>{const shader={uniforms:{},vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};(mesh.material as MeshPhysicalMaterial).onBeforeCompile(shader as never,null as never);return shader;};
 const riverShader=compile(water),seaShader=compile(sea);assert.deepEqual(profiles,['river','sea']);assert.match(riverShader.fragmentShader,/coord = vec2\(-p\.x, shore\.x\)/);assert.doesNotMatch(seaShader.fragmentShader,/coord = vec2\(-p\.x, shore\.x\)/);
 let seaDisposals=0;(sea.material as MeshPhysicalMaterial).addEventListener('dispose',()=>seaDisposals++);handle.dispose();handle.dispose();assert.equal(seaDisposals,1);assert.equal(backendDisposals,0);assert.equal(terrain.material,original);geometry.dispose();original.dispose();
});
