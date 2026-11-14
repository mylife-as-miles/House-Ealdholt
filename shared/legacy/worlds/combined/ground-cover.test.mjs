import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'crownfall-world-three';
import {createSourceGroundCover} from './ground-cover.js';
import {grassTuft,reeds,shrub} from '../monolithwilds/src/world/vegetation-geo.js';
import {createRng,worldNoise} from '../monolithwilds/src/core/noise.js';
import {settlementHeight} from '../../environment/settlement/layout.ts';

const shader=()=>({uniforms:{},vertexShader:'#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>\n#include <normal_fragment_begin>\n#include <lights_fragment_end>'});
test('actual source grass, reeds and shrub are four passable bounded draws with original geometry and source-local motion',()=>{
 const cover=createSourceGroundCover({THREE:T,groundAt:settlementHeight}),sourceGrass=grassTuft(worldNoise,createRng('combined-ground-grass')),sourceReed=reeds(worldNoise,createRng('combined-ground-reeds')),sourceShrub=shrub(worldNoise,createRng('combined-ground-shrub')),original=[sourceGrass,sourceReed.lods[0],sourceReed.lods[1],sourceShrub.lods[1]],camera=new T.PerspectiveCamera();
 try{
  const report=cover.getInfo();assert.equal(report.included,true);assert.equal(report.drawCalls,4);assert.ok(report.triangles<=6860);assert.deepEqual(report.sites.map(s=>s.sourceTriangles),[34,248,5,20]);
  for(const [i,mesh] of cover.root.children.entries()){
   assert.ok(mesh instanceof T.Mesh);assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,true);assert.equal(mesh.userData.sourceAsset.license,'MIT');assert.equal(mesh.userData.sourceAsset.commit,'02dbcd3e790c21861dfecb47f4d9e23cccee35ec');
   const geometry=mesh.geometry;assert.deepEqual(geometry.index.array,original[i].index.array);for(const name of ['color','aVeg'])assert.deepEqual(geometry.attributes[name].array,original[i].attributes[name].array,`${name} remains actual source data`);
   const yScale=i===1||i===2?1.5:1;
   for(let v=0;v<geometry.attributes.position.count;v++){
    const a=geometry.attributes.position,b=original[i].attributes.position;assert.equal(a.getX(v),b.getX(v));assert.equal(a.getZ(v),b.getZ(v));assert.ok(Math.abs(a.getY(v)-b.getY(v)*yScale)<1e-6,'reed-only vertical fit keeps original source geometry and XZ footprint');
    const sourceNormal=original[i].attributes.normal,n=new T.Vector3(sourceNormal.getX(v),sourceNormal.getY(v)/yScale,sourceNormal.getZ(v)).normalize(),actual=geometry.attributes.normal;assert.ok(new T.Vector3(actual.getX(v),actual.getY(v),actual.getZ(v)).distanceTo(n)<1e-6);
    assert.ok(Math.abs(geometry.attributes.aVeg2.getX(v)-original[i].attributes.aVeg2.getX(v)*yScale)<1e-6);assert.equal(geometry.attributes.aVeg2.getY(v),original[i].attributes.aVeg2.getY(v));
   }
   for(const name of ['aInstA','aInstB'])assert.ok(geometry.attributes[name]);assert.ok(geometry.boundingBox.min.toArray().every(Number.isFinite));assert.ok(geometry.boundingBox.max.toArray().every(Number.isFinite));
   const intersections=[];mesh.raycast(new T.Raycaster(),intersections);assert.equal(intersections.length,0,'passable visual cover does not steal actual building or ground clicks');
   for(const material of [mesh.material,mesh.customDepthMaterial]){const s=shader();material.onBeforeCompile(s);assert.match(s.vertexShader,/vec3 p = position/);assert.match(s.vertexShader,/uVegTime/);assert.ok(s.uniforms.uMwSourceCamera);}
  }
  const s=shader();cover.root.children[0].material.onBeforeCompile(s);camera.position.set(2,4,9);cover.root.position.set(3,1,5);cover.root.scale.setScalar(.01);cover.update(.05,camera);const clock=s.uniforms.uVegTime.value.x;assert.equal(clock,.05);assert.ok(s.uniforms.uMwSourceCamera.value.distanceTo(new T.Vector3(-100,300,400))<1e-6);
  cover.setReducedMotion(true);cover.update(.1,camera);assert.equal(s.uniforms.uVegTime.value.x,clock);assert.equal(s.uniforms.uVegTime.value.z,-.3);cover.setReducedMotion(false);cover.update(200,camera);assert.equal(s.uniforms.uVegTime.value.x,clock+.1,'no long-frame catch-up');
 }finally{cover.dispose();for(const g of [sourceGrass,...sourceReed.lods,...sourceShrub.lods])g.dispose();}
});
test('source ground cover owns and releases each runtime geometry/material once without a renderer or loop',()=>{
 const cover=createSourceGroundCover({THREE:T,groundAt:settlementHeight}),resources=new Set(),counts=new Map();cover.root.traverse(o=>{for(const r of [o.geometry,o.material,o.customDepthMaterial].filter(Boolean))resources.add(r);});for(const resource of resources){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
 cover.dispose();cover.dispose();assert.equal(cover.root.children.length,0);assert.equal(cover.getInfo().included,false);for(const resource of resources)assert.equal(counts.get(resource),1);
});
