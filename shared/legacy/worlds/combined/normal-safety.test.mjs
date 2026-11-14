import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../../../main game/node_modules/three/build/three.module.js';
import { createGeometryCompactor,repairInvalidNormals } from '../athenaion/compact.js';

test('source LOD keeps opposing thin faces separate instead of cancelling their normals',()=>{
 const positions=[],normals=[],indices=[];
 for(const sign of [1,-1])for(let face=0;face<4;face++){
  const z=sign*.003,triangle=face===3?[[.3,.3],[.302,.3],[.3,.302]]:[[0,0],[1,0],[0,1]];
  for(const [x,y] of triangle){indices.push(indices.length);positions.push(x,y,z);normals.push(0,0,sign);}
 }
 const original=new T.BufferGeometry();original.setAttribute('position',new T.Float32BufferAttribute(positions,3));original.setAttribute('normal',new T.Float32BufferAttribute(normals,3));original.setIndex(indices);
 const before=Array.from(original.attributes.normal.array),compact=createGeometryCompactor(T,'desktop',{preserveNormalCreases:true}),result=compact(original,'source thin timber');
 assert.notEqual(result,original,'the fixture really exercises reduction');assert.ok(result.index.count<original.index.count);
 const normal=result.attributes.normal,signs=new Set();for(let i=0;i<normal.count;i++){assert.ok(Math.abs(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))-1)<1e-6);signs.add(Math.sign(normal.getZ(i)));}
 assert.deepEqual([...signs].sort(),[-1,1]);assert.deepEqual(Array.from(original.attributes.normal.array),before,'borrowed source geometry remains untouched');
 result.dispose();original.dispose();
});

test('an invalid input frame recovers its actual adjacent geometric normal',()=>{
 const original=new T.PlaneGeometry(2,2);original.attributes.normal.setXYZ(0,0,0,0);
 const fixed=repairInvalidNormals(T,original);assert.notEqual(fixed,original);assert.equal(original.attributes.normal.getZ(0),0);
 assert.equal(fixed.attributes.normal.getZ(0),1);assert.ok(Array.from(fixed.attributes.normal.array).every(Number.isFinite));
 const again=repairInvalidNormals(T,fixed);assert.equal(again,fixed,'valid source frames are not modified');fixed.dispose();original.dispose();
});
