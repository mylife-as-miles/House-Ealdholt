import assert from 'node:assert/strict';
import test from 'node:test';
import { groundUv,groundAlbedo,rasterGround,rasterSourceGrass } from '../aethelgard/environment/ground-atlas';

const bounds={minX:0,maxX:2,minZ:0,maxZ:2};
const mesh={positions:new Float32Array([0,0,0,2,2,0,2,2,2,0,0,2]),normals:new Float32Array([-.707,.707,0,-.707,.707,0,-.707,.707,0,-.707,.707,0]),indices:[0,1,2,0,2,3]};
test('ground atlas raster interpolates real sloping triangles rather than a flat plane',()=>{
  const surface=rasterGround([mesh],bounds,4);
  assert.equal(surface.coveredPixels,16);
  assert.equal(surface.heights[0],.25);
  assert.equal(surface.heights[3],1.75);
  assert.deepEqual(groundUv(1,1,bounds),[.5,.5]);
  assert.throws(()=>groundUv(1,1,{...bounds,maxX:0}),RangeError);
});
test('source footprint splat uses sampled ground height and leaves unsupported paths clear',()=>{
  const surface=rasterGround([mesh],bounds,16),site={origin:[.5,.5,.5] as const,footprintRadius:.5};
  const density=rasterSourceGrass([site],surface,bounds),raised=rasterSourceGrass([{...site,origin:[.5,4,.5]}],surface,bounds);
  assert.ok(density.some(v=>v>0));
  assert.equal(density[255],0);
  assert.ok(raised.every(v=>v===0));
  assert.deepEqual(density,rasterSourceGrass([site,site],surface,bounds));
});
test('3D microtexture is deterministic, bounded and does not introduce plant coverage',()=>{
  const soil=groundAlbedo(1,1,1,0,0),grass=groundAlbedo(1,1,1,0,1),rock=groundAlbedo(1,1,1,2,0);
  assert.deepEqual(soil,groundAlbedo(1,1,1,0,0));
  assert.ok(grass[1]/grass[0]>soil[1]/soil[0]);
  assert.ok(rock[2]>rock[0]);
  assert.notDeepEqual(rock,groundAlbedo(1,2,1,2,0));
  for(let i=0;i<100;i++) assert.ok(groundAlbedo(i/7,i/11,-i/9,i/40,i/100).every(v=>Number.isInteger(v)&&v>=0&&v<=255));
});
