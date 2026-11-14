import test from 'node:test';import assert from 'node:assert/strict';
import {regionalDetailFocus,regionalTreePriority} from '../aethelgard/environment/regional-detail-focus';
test('an overhead view prioritizes real woodland around the viewed clearing rather than a large empty cell box',()=>{
 const focus={x:0,y:0,z:0};regionalDetailFocus(focus,{x:25,y:90,z:90},{x:0,y:-.8,z:-.6},2);assert.deepEqual(focus,{x:25,y:2,z:24});
 const trees=Float32Array.from([120,0,120,0,1,0,25,0,-25,0,1,1,25,0,25,0,1,12]);const unchanged=trees.slice();
 assert.ok(regionalTreePriority(trees,Uint32Array.of(1),focus)<regionalTreePriority(trees,Uint32Array.of(0),focus));
 assert.equal(regionalTreePriority(trees,Uint32Array.of(2),focus),Infinity,'Shrubs cannot displace the close-tree residency budget.');assert.deepEqual(trees,unchanged);
 regionalDetailFocus(focus,{x:2,y:3,z:4},{x:0,y:0,z:-1},2);assert.deepEqual(focus,{x:2,y:3,z:4},'Ground-level horizontal views keep camera-centred detail.');
});
