import assert from 'node:assert/strict';
import test from 'node:test';
import {buildStaticVoxelVolume, type VoxelSourceProxy} from './voxel-volume';
import {quantizeVoxelRadiance, traceLocalVoxelIndirect, VOXEL_INDIRECT_GAIN, type VoxelLocalLight} from './voxel-indirect';

const at=(x:number,y:number,z:number)=>(x+16*(y+6*z))*3;
function corner(sealed=false){
 const wall=(min:VoxelSourceProxy['min'],max:VoxelSourceProxy['max']):VoxelSourceProxy=>({min,max,albedo:[.85,.8,.7],opacity:1});
 return buildStaticVoxelVolume({grid:{resolution:[16,6,16],min:[0,0,0],size:[16,6,16]},terrainHeights:new Float32Array(256).fill(1),
  proxies:[wall([0,0,0],[1,6,16]),wall([15,0,0],[16,6,16]),wall([0,0,0],[16,6,1]),wall([0,0,15],[16,6,16]),wall([0,5,0],[16,6,16]),wall([7,0,0],[8,6,sealed?16:9])]});
}
const fire:VoxelLocalLight={position:[3.5,2.5,3.5],radius:30,radiance:[32,8,1]};

test('occluded corner receives measurable second-order firelight, whereas sealing the bend blocks every order',()=>{
 const volume=corner(),original=volume.albedoOpacity.slice(),transport=volume.transport.slice();
 const direct=traceLocalVoxelIndirect(volume,[fire],0),once=traceLocalVoxelIndirect(volume,[fire],1),twice=traceLocalVoxelIndirect(volume,[fire],2),receiver=at(11,3,7);
 assert.equal(direct.seed[receiver],0,'The receiver has no locally injected fire emission.');
 assert.equal(direct.irradiance[receiver],0,'Direct-seed gathering alone cannot reach around this corner.');
 assert.ok(once.irradiance[receiver]>0,'A surface reflection reaches the occluded receiver.');
 assert.ok(twice.irradiance[receiver]>once.irradiance[receiver]*1.5,'The independently executed second reflection contributes additional light.');
 assert.ok(twice.irradiance[receiver]>twice.irradiance[receiver+1],'Transport retains the warm fire spectrum.');
 const sealed=traceLocalVoxelIndirect(corner(true),[fire]);
 for(let z=1;z<15;z++)for(let y=1;y<5;y++)for(let x=8;x<15;x++)for(let c=0;c<3;c++)assert.equal(sealed.irradiance[at(x,y,z)+c],0,'Opaque wall must not become an isotropic through-wall emitter.');
 assert.deepEqual(volume.albedoOpacity,original);assert.deepEqual(volume.transport,transport);
});

test('local injection uses occupied-face visibility; moving the same emitter to the receiver side restores direct illumination',()=>{
 const volume=corner(),blocked=traceLocalVoxelIndirect(volume,[fire],0),visible=traceLocalVoxelIndirect(volume,[{...fire,position:[10.5,2.5,3.5]}],0),back=at(8,2,3);
 assert.equal(blocked.directVisibility[back/3],0);assert.equal(blocked.seed[back],0);
 assert.equal(visible.directVisibility[back/3],1);assert.ok(visible.seed[back]>0);
});

test('fresh-seed fixed steps are deterministic, extinguish immediately and bound reflected energy without temporal feedback',()=>{
 const volume=corner(),dim={...fire,radiance:[.8,.2,.025]as const},first=traceLocalVoxelIndirect(volume,[dim]),again=traceLocalVoxelIndirect(volume,[dim]);
 assert.deepEqual(first,again,'Repeated requests do not reinject the previously published field.');
 const dark=traceLocalVoxelIndirect(volume,[]);assert.equal(dark.seed.some(Boolean),false);assert.equal(dark.irradiance.some(Boolean),false);
 // The gather is an average of <=1 oriented, attenuated surface per ray.
 // RGBA8 square-root encoding adds <=.032 absolute rounding error in [0,8].
 let maximum=Math.max(...first.seed);
 for(const order of first.orders){const next=Math.max(...order);assert.ok(next<=Math.max(...first.seed)+VOXEL_INDIRECT_GAIN*maximum+.032);assert.ok(next<1,'This energy check is unsaturated.');maximum=next;}
 assert.ok(quantizeVoxelRadiance(.0005)>0,'Dim indirect energy survives the bounded RGBA8 field.');
 assert.throws(()=>traceLocalVoxelIndirect(volume,[{...fire,radius:NaN}]),/Invalid/);
 assert.throws(()=>traceLocalVoxelIndirect(volume,[fire],3),/Invalid/);
});
