import test from 'node:test';import assert from 'node:assert/strict';
import {appendRegionalVoxelSource} from '../aethelgard/environment/regional-voxel-source';
import {REGIONAL_VEGETATION_PROTOTYPES as prototypes} from '../aethelgard/environment/regional-assets';
import type {VoxelRegionSource} from '../aethelgard/environment/voxel-source-index';
const source:VoxelRegionSource={worldRegion:'ealdholt',sourceSha256:'a'.repeat(64),generatorVersion:'source-v1',backend:'webgl2',terrain:[],proxies:[]};
const horizon={positions:new Float32Array([0,0,0,1,0,0,0,0,1]),indices:new Uint32Array([0,2,1]),bounds:{min:[0,0,0] as const,max:[1,0,1] as const}};
test('regional GI uses permanent canopy data and preserves source geometry independently of visual streaming',()=>{
 const placements=new Float32Array([50,2,75,.7,1.2,2]),layout={version:'regional-v2',treeCount:1,shrubCount:0,placements,rocks:new Float32Array(),cells:[],landmarks:[],species:[],attempts:1,rejected:{}};
 const result=appendRegionalVoxelSource(source,layout,prototypes,horizon);assert.equal(source.proxies.length,0);assert.equal(source.terrain.length,0);assert.equal(result.proxies.length,1);assert.equal(result.terrain[0],horizon);
 const canopy=result.proxies[0];assert.ok(canopy.min[0]<50&&canopy.max[0]>50&&canopy.min[1]>2&&canopy.max[1]>10);assert.ok(canopy.opacity>0&&canopy.opacity<1);
 assert.deepEqual(Array.from(placements),[50,2,75,Math.fround(.7),Math.fround(1.2),2]);
 assert.equal(result.generatorVersion,'source-v1:regional-v2:coarse-canopy-v1');
});
