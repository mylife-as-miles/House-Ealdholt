import assert from 'node:assert/strict';
import test from 'node:test';
import {compareRegionalDetailCells,regionalDetailFocus,regionalTreePriority} from './regional-detail-focus';

test('woodland beside the viewer keeps detail before a distant look target',()=>{
 assert.ok(compareRegionalDetailCells(4,20000,130,1)<0);
 assert.ok(compareRegionalDetailCells(130,1,4,20000)>0);
 assert.ok(compareRegionalDetailCells(0,40000,40,1)<0,'camera-containing cells cannot lose detail to a distant focal point');
});
test('outside the near band, viewed tree roots still win over coarse cell centres',()=>{
 assert.ok(compareRegionalDetailCells(120,9,100,400)<0);
 assert.ok(compareRegionalDetailCells(100,9,120,9)<0);
 assert.equal(compareRegionalDetailCells(100,9,100,9),0);
 assert.ok(compareRegionalDetailCells(100,Infinity,120,Infinity)<0,'shrub-only cells retain a stable finite distance tie-break');
});
test('a bounded low-quality selection includes the camera cell and stays deterministic',()=>{
 const cells=[{id:'focus',camera:160,focus:0},{id:'near-edge',camera:23,focus:900},{id:'camera',camera:0,focus:2500},{id:'other-near',camera:57,focus:400}];
 const select=(rows:typeof cells)=>rows.slice().sort((a,b)=>compareRegionalDetailCells(a.camera,a.focus,b.camera,b.focus)||a.id.localeCompare(b.id)).slice(0,3).map(c=>c.id);
 assert.deepEqual(select(cells),['camera','near-edge','other-near']);assert.deepEqual(select([...cells].reverse()),select(cells));
});
test('focus follows the existing ground ray and priority uses real tree roots only',()=>{
 const target={x:0,y:0,z:0};regionalDetailFocus(target,{x:40,y:20,z:10},{x:-.6,y:-.8,z:0},0);
 assert.deepEqual(target,{x:25,y:0,z:10});
 const actors=Float32Array.from([100,0,100,0,1,0, 25,0,10,0,1,12, 26,0,10,0,1,1]);
 assert.equal(regionalTreePriority(actors,Uint32Array.from([0,1,2]),target),1);
 assert.equal(regionalTreePriority(actors,Uint32Array.from([1]),target),Infinity);
});
