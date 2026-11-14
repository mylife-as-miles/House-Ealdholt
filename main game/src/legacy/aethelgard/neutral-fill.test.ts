import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three';
import { applyEaldholtNeutralFill } from './neutral-fill';
import { EALDHOLT_NEUTRAL_FILL_CACHE_KEY } from '../../../../shared/legacy/aethelgard/environment/neutral-fill';

test('neutral IBL clones own materials only while preserving PBR maps, hooks, cache semantics and array restoration',()=>{
  const root=new Group(),geometry=new BoxGeometry(),map=new Texture(),normal=new Texture(),env=new Texture();
  const source=new MeshPhysicalMaterial({map,normalMap:normal,envMap:env,envMapIntensity:.16,ior:1.333,clearcoat:.3,metalness:.1,roughness:.24});
  let compileThis:unknown,renderThis:unknown;
  source.onBeforeCompile=function sourceHook(shader){compileThis=this;shader.fragmentShader+='\n// previous ripple/ground hook';};
  source.onBeforeRender=function(){renderThis=this;};const priorKey=source.customProgramCacheKey();
  const basic=new MeshBasicMaterial(),array=[source,basic],a=new Mesh(geometry,source),b=new Mesh(geometry,array);root.add(a,b);
  let borrowed=0;for(const resource of [map,normal,env,geometry,source,basic])resource.addEventListener('dispose',()=>borrowed++);
  const look=applyEaldholtNeutralFill(root),clone=a.material;
  assert.equal(look.materialCount,1);assert.equal(look.extraDrawCalls,0);assert.equal(look.extraTextureBytes,0);assert.ok(clone instanceof MeshPhysicalMaterial);assert.notEqual(clone,source);
  assert.equal(clone.map,map);assert.equal(clone.normalMap,normal);assert.equal(clone.envMap,env);assert.equal(clone.envMapIntensity,.16);assert.equal(clone.ior,1.333);assert.equal(clone.clearcoat,.3);assert.equal(clone.metalness,.1);assert.equal(clone.roughness,.24);
  assert.equal(b.material[0],clone);assert.equal(b.material[1],basic);assert.equal(clone.customProgramCacheKey(),priorKey+EALDHOLT_NEUTRAL_FILL_CACHE_KEY);
  const shader={uniforms:{},fragmentShader:'#include <common>\n#include <lights_fragment_maps>'};clone.onBeforeCompile(shader as never,null as never);clone.onBeforeRender(null as never,null as never,null as never,geometry,a,null as never);
  assert.equal(compileThis,clone);assert.equal(renderThis,clone);assert.match(shader.fragmentShader,/previous ripple\/ground hook/);assert.match(shader.fragmentShader,/CROWNFALL_IBL_NEUTRAL_FILL/);
  let disposed=0;clone.addEventListener('dispose',()=>disposed++);look.dispose();look.dispose();assert.equal(disposed,1);assert.equal(borrowed,0);assert.equal(a.material,source);assert.equal(b.material,array);
  source.dispose();basic.dispose();geometry.dispose();for(const texture of [map,normal,env])texture.dispose();
});
test('partial neutral-fill setup failure restores prior assignments without touching cached materials',()=>{
  const root=new Group(),geometry=new BoxGeometry(),source=new MeshStandardMaterial(),bad=new MeshStandardMaterial();
  bad.clone=()=>{throw Error('Injected clone failure');};const a=new Mesh(geometry,source),b=new Mesh(geometry,bad);root.add(a,b);
  let sourceDisposals=0;source.addEventListener('dispose',()=>sourceDisposals++);
  assert.throws(()=>applyEaldholtNeutralFill(root),/Injected/);assert.equal(a.material,source);assert.equal(b.material,bad);assert.equal(sourceDisposals,0);
  source.dispose();bad.dispose();geometry.dispose();
});
