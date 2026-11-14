import assert from 'node:assert/strict';
import { test } from 'node:test';
import { patchSourceMaterial } from './coordinates.js';
const values=[{value:{}},{value:{}},{value:{}}];
test('source metre positions project back into the native scene, including variable wp',()=>{
 const material={isShaderMaterial:true,uniforms:{},vertexShader:'void main(){vec4 wp=modelMatrix*vec4(position,1.0);gl_Position = projectionMatrix * viewMatrix * wp;}',fragmentShader:'void main(){vec3 view=cameraPosition;}',};
 patchSourceMaterial(material,...values,new WeakSet());
 assert.match(material.vertexShader,/wp=\(uCrownSourceInverse \* modelMatrix\)/);
 assert.match(material.vertexShader,/gl_Position = projectionMatrix \* viewMatrix \* uCrownSourceMatrix \* wp/);
 assert.match(material.fragmentShader,/view=uCrownSourceCamera/);
});
test('physical model-view projection is preserved for ordinary meshes',()=>{
 const material={isShaderMaterial:true,uniforms:{},vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'void main(){}'};
 patchSourceMaterial(material,...values,new WeakSet());
 assert.ok(material.vertexShader.includes('gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0)'));
});
test('source fog uses the source eye position without patching global shader chunks',()=>{
 const material={isShaderMaterial:false,onBeforeCompile(){},fog:true};
 patchSourceMaterial(material,...values,new WeakSet(),{},'vec3 atmoApply(vec3 col,vec3 wp){return atmoApplyFrom(col, cameraPosition, wp); }');
 const shader={uniforms:{},vertexShader:'void main(){#include <worldpos_vertex>}',fragmentShader:'#include <fog_pars_fragment>\nvoid main(){#include <fog_fragment>}'};
 material.onBeforeCompile(shader,{});
 assert.match(shader.vertexShader,/vCrownSourcePosition=\(\(uCrownSourceInverse \* modelMatrix\)\*cp\)/);
 assert.match(shader.fragmentShader,/atmoApplyFrom\(col, uCrownSourceCamera, wp\)/);
 assert.ok(!shader.fragmentShader.includes('#define modelMatrix'));
});

test('source premultiplied-water fog keeps local source metres after its hook replaced fog_fragment',()=>{
 const material={isShaderMaterial:false,fog:true,onBeforeCompile(shader){shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>','vec3 A=atmoApply(vec3(0.0),vAtmoWorldPos);');}};
 patchSourceMaterial(material,...values,new WeakSet(),{},'vec3 atmoApply(vec3 col,vec3 wp){return atmoApplyFrom(col, cameraPosition, wp); }');
 const shader={uniforms:{},vertexShader:'void main(){#include <worldpos_vertex>}',fragmentShader:'#include <fog_pars_fragment>\nvoid main(){#include <fog_fragment>}'};
 material.onBeforeCompile(shader,{});
 assert.ok(!shader.fragmentShader.includes('vAtmoWorldPos'));
 assert.match(shader.fragmentShader,/varying vec3 vCrownSourcePosition/);
 assert.match(shader.vertexShader,/varying vec3 vCrownSourcePosition/);
 assert.match(shader.fragmentShader,/A=atmoApply\(vec3\(0.0\),vCrownSourcePosition\)/);
 assert.match(shader.fragmentShader,/atmoApplyFrom\(col, uCrownSourceCamera, wp\)/);
});
