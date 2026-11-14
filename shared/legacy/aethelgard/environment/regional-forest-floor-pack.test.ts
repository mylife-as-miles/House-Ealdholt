import assert from 'node:assert/strict';
import test from 'node:test';
import {packRegionalForestFloor} from './regional-forest-floor-pack';
import {patchRegionalForestFloor,REGIONAL_FOREST_FLOOR_VERSION} from './regional-forest-floor';

function litter(size=4){const data=new Uint8ClampedArray(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++)data.set([x*53,y*59,(x+y)*29,255],(y*size+x)*4);return data;}
test('packed floor retains every encoded RGB and linear cover byte without changing its borrowed inputs',()=>{
 const size=4,rgb=litter(size),cover=Uint8Array.from({length:size*size},(_,i)=>i*17),before=rgb.slice(),beforeCover=cover.slice();
 for(const flipY of [false,true]){
  const packed=packRegionalForestFloor({size,data:rgb,flipY},cover,size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const from=((flipY?size-1-y:y)*size+x)*4,to=(y*size+x)*4;
   assert.deepEqual(packed.slice(to,to+3),Uint8Array.from(rgb.slice(from,from+3)));
   assert.equal(packed[to+3],cover[y*size+x],'Coverage orientation is independent of litter orientation.');
  }
  assert.notEqual(packed.buffer,rgb.buffer);assert.notEqual(packed.buffer,cover.buffer);
 }
 assert.deepEqual(rgb,before);assert.deepEqual(cover,beforeCover);
});
test('packing refuses mismatched, translucent, unbounded or unsupported sources without mutating them',()=>{
 const source={size:4,data:litter(),flipY:false},cover=new Uint8Array(16);
 assert.throws(()=>packRegionalForestFloor(source,cover,8),/Incompatible/);
 assert.throws(()=>packRegionalForestFloor(source,cover.subarray(1),4),/Incompatible/);
 assert.throws(()=>packRegionalForestFloor({...source,size:3},new Uint8Array(9),3),/Incompatible/);
 assert.throws(()=>packRegionalForestFloor(source,cover,2048),/Incompatible/);
 source.data[3]=0;const before=source.data.slice();assert.throws(()=>packRegionalForestFloor(source,cover,4),/opaque/);assert.deepEqual(source.data,before);
});
test('floor shader uses one packed sampler while preserving clamped base-level coverage and repeating photographic RGB',()=>{
 const shader={uniforms:{},vertexShader:'#include <project_vertex>',fragmentShader:'#include <metalnessmap_fragment>'};
 const uniform={value:null};patchRegionalForestFloor(shader,{cfForestLitterCover:uniform});
 assert.equal((shader.uniforms as Record<string,unknown>).cfForestLitterCover,uniform);
 assert.equal([...shader.fragmentShader.matchAll(/uniform sampler2D /g)].length,1);
 assert.match(shader.fragmentShader,/textureLod\(cfForestLitterCover,clamp\(forestUv,forestHalfTexel,1\.-forestHalfTexel\),0\.\)\.a/);
 assert.match(shader.fragmentShader,/texture2D\(cfForestLitterCover,vForestSource\.xz\/2\.8\)\.rgb/);
 assert.match(shader.fragmentShader,/forestInside/);assert.match(shader.fragmentShader,/#include <metalnessmap_fragment>/);
 assert.equal(REGIONAL_FOREST_FLOOR_VERSION,'canopy-area-v3','Packing must not alter the geographic coverage identity.');
});
