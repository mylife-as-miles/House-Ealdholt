import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'crownfall-world-three';
import {SETTLEMENT_LIGHTING,SETTLEMENT_SUN_DIRECTION} from '../../environment/settlement/lighting.ts';
import {createCombinedWorldKit} from './kit.ts';
import {createArchitectureKit} from './architecture.js';
import {G} from '../golden-temple/upstream/core/env.js';
import {settlementHeight} from '../../environment/settlement/layout.ts';
const expectDirection=value=>assert.ok(value.clone().normalize().distanceTo(new T.Vector3(...SETTLEMENT_SUN_DIRECTION))<1e-10);
const shader=()=>({uniforms:{},vertexShader:'#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>\n#include <normal_fragment_begin>\n#include <lights_fragment_end>'});

test('Native real sun and source-space inputs agree under a rotated scaled miniature without retuning intensities',()=>{
 const parent=new T.Group(),kit=createCombinedWorldKit({THREE:T,profile:'quest',quality:'low',groundAt:settlementHeight});parent.position.set(.3,.9,-1);parent.rotation.y=.8;parent.scale.setScalar(.01);parent.add(kit.root);
 try{
  const light=kit.root.children.find(o=>o.isDirectionalLight),hemi=kit.root.children.find(o=>o.isHemisphereLight);assert.ok(light&&hemi);assert.equal(light.intensity,1.8);assert.equal(hemi.intensity,1.1);assert.equal(light.castShadow,false);assert.equal(light.color.getHexString(),'fff0d2');assert.equal(hemi.color.getHexString(),'d3dfdf');assert.equal(hemi.groundColor.getHexString(),'635740');assert.ok(Math.abs(light.position.length()-Math.hypot(70,140,90))<1e-10);
  parent.updateMatrixWorld(true);const real=light.getWorldPosition(new T.Vector3()).sub(light.target.getWorldPosition(new T.Vector3())).transformDirection(kit.root.matrixWorld.clone().invert());expectDirection(real);
  const camera=new T.PerspectiveCamera();camera.position.set(1,2,2);kit.update(.016,camera);
  let vegetation=0,water=0;kit.root.traverse(o=>{if(!o.isMesh)return;if(o.name.includes('edge forest')||o.name.includes('ground cover')){const s=shader();o.material.onBeforeCompile(s);expectDirection(s.uniforms.uVegKeyDir.value);vegetation++;}if(o.userData.sourceAssetId==='crownfall-original-estate-water'){assert.ok(o.material instanceof T.MeshPhysicalMaterial,'original water uses the actual scene light path');assert.equal(o.material.metalness,0);assert.equal(o.material.userData.sourceShader.usesUpstreamAlpineCode,false);const frame=o.material.userData.crownfallWaterUniforms.worldToSource.value;assert.ok(new T.Vector3(3,.55,7).applyMatrix4(kit.root.matrixWorld).applyMatrix4(frame).distanceTo(new T.Vector3(3,.55,7))<1e-9);water++;}});assert.equal(vegetation,8);assert.equal(water,1);
 }finally{kit.dispose();}
});
test('Temple uses kit-owned coherent sun input while upstream global vectors and radiance stay untouched',()=>{
 const before={dir:G.uSunDir.value.toArray(),colour:G.uSunColor.value.toArray()},kit=createArchitectureKit({THREE:T,profile:'quest'}),group=kit.build({id:'preview',kind:'pavilion',width:4,depth:4,height:5});let checked=0;
 try{group.traverse(o=>{if(!o.isMesh)return;const s=shader();o.material.onBeforeCompile(s);if(s.uniforms.uSunDir){expectDirection(s.uniforms.uSunDir.value);assert.notEqual(s.uniforms.uSunDir,G.uSunDir);assert.deepEqual(s.uniforms.uSunColor.value.toArray(),before.colour);checked++;}});assert.ok(checked>0);assert.deepEqual(G.uSunDir.value.toArray(),before.dir);assert.deepEqual(G.uSunColor.value.toArray(),before.colour);}
 finally{group.traverse(o=>o.geometry?.dispose());kit.dispose();}
});
test('canonical blueprint direction is finite unit length with the existing calibrated sun inputs',()=>{
 assert.deepEqual(SETTLEMENT_LIGHTING.sun,{bearingDeg:310,elevationDeg:53,colour:'#fff0d2',intensity:.86});assert.ok(Object.isFrozen(SETTLEMENT_SUN_DIRECTION));assert.ok(Math.abs(Math.hypot(...SETTLEMENT_SUN_DIRECTION)-1)<1e-12);assert.ok(SETTLEMENT_SUN_DIRECTION.every(Number.isFinite));assert.ok(SETTLEMENT_SUN_DIRECTION[2]<0,'the source sun illuminates north-facing rather than south-facing walls');
});
