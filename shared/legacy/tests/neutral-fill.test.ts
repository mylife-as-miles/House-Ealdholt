import assert from 'node:assert/strict';
import test from 'node:test';
import { EALDHOLT_NEUTRAL_FILL_STRENGTH, EALDHOLT_NEUTRAL_HEMISPHERE_SKY_LINEAR, neutralizeEaldholtRadiance, patchEaldholtNeutralFill } from '../aethelgard/environment/neutral-fill';
const y=(c:readonly number[])=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
test('indirect white balance preserves linear luminance and HDR energy without clipping or raising exposure',()=>{
  for(const input of [[0,0,0],[.5,.5,.5],[0,4,0],[300,20,7],[.375843669,.537690395,.696657068]]as const){
    const output=neutralizeEaldholtRadiance(input);
    assert.ok(Math.abs(y(output)-y(input))<1e-10);
    for(let c=0;c<3;c++)assert.ok(Math.abs(output[c]-(input[c]*.3+y(input)*.7))<1e-10);
  }
  assert.deepEqual(neutralizeEaldholtRadiance([.5,.5,.5]),[.5,.5,.5]);
  assert.ok(neutralizeEaldholtRadiance([300,20,7])[0]>1,'HDR energy is not clamped to display space');
  for(const bad of [[-1,0,0],[NaN,0,0],[0,Infinity,0]]as [number,number,number][])assert.throws(()=>neutralizeEaldholtRadiance(bad),/linear radiance/);
  const original=[182,207,224].map(c=>{const v=c/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
  assert.ok(Math.abs(y(original)-y(EALDHOLT_NEUTRAL_HEMISPHERE_SKY_LINEAR))<1e-12);
});
test('IBL correction remains after map accumulation and inside exactly scoped PBR guards',()=>{
  const shader={uniforms:{} as Record<string,{value:unknown}>,fragmentShader:'#include <common>\nvoid main(){\n#include <lights_fragment_maps>\n#include <lights_fragment_end>\n}'};
  patchEaldholtNeutralFill(shader);const source=shader.fragmentShader;
  assert.equal(shader.uniforms.uEaldholtIblNeutralMix.value,EALDHOLT_NEUTRAL_FILL_STRENGTH);
  assert.ok(source.indexOf('iblIrradiance=ealdholtNeutralIbl')>source.indexOf('#include <lights_fragment_maps>'));
  assert.ok(source.indexOf('radiance=ealdholtNeutralIbl')<source.indexOf('#include <lights_fragment_end>'));
  assert.match(source,/#if defined\(USE_ENVMAP\) && defined\(ENVMAP_TYPE_CUBE_UV\)/);
  assert.match(source,/#if defined\(RE_IndirectDiffuse\) && \(defined\(STANDARD\) \|\| defined\(LAMBERT\) \|\| defined\(PHONG\)\)/);
  assert.match(source,/#if defined\(RE_IndirectSpecular\)/);assert.match(source,/#ifdef USE_CLEARCOAT\n      clearcoatRadiance=/);
  assert.doesNotMatch(source,/irradiance=|directLight|diffuseColor|texture2D|textureLod|exposure|pow\(/);
  patchEaldholtNeutralFill(shader);assert.equal(shader.fragmentShader,source);
  assert.throws(()=>patchEaldholtNeutralFill({uniforms:{},fragmentShader:'#include <common>'}),/standard PBR/);
});
